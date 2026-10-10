import asyncio
import hashlib
import json
import threading
import time
import uuid
from collections import Counter
from typing import Any

from .config import Settings
from .generation import ExtractiveGenerator, OllamaGenerator, classify, verify_claims
from .models import Answer, Document, Query
from .retrieval import Retriever, SentenceEmbedder
from .storage import Store


class Service:
    def __init__(self, config: Settings, embedder: Any = None):
        self.config = config
        seed = [
            Document.model_validate(d)
            for d in json.loads((config.data_dir / "corpus.json").read_text())
        ]
        self.store = Store(config.database_url, seed)
        self.embedder = embedder or SentenceEmbedder(config.embedding_model)
        self.retriever = self.build_index()
        self.document_fingerprint = self.fingerprint(self.retriever.documents)
        self.reload_lock = threading.Lock()
        self.generator = (
            OllamaGenerator(config.ollama_url, config.ollama_model)
            if config.provider == "ollama"
            else ExtractiveGenerator()
        )
        self.cache: dict[str, tuple[float, str]] = {}
        self.cache_lock = threading.Lock()
        self.semaphore = asyncio.Semaphore(config.max_concurrency)
        self.metrics: Counter[str] = Counter()
        self.latencies: list[float] = []
        self.recent_requests: dict[str, float] = {}
        self.redis = None
        if config.redis_url:
            from redis.asyncio import Redis

            self.redis = Redis.from_url(config.redis_url, decode_responses=True)

    @staticmethod
    def fingerprint(documents: list[Document]) -> str:
        return hashlib.sha256(
            "".join(sorted(d.id + d.sha256 + d.version for d in documents)).encode()
        ).hexdigest()

    def build_index(self) -> Retriever:
        retriever = Retriever(
            self.store.list_documents(),
            self.embedder,
            self.config.data_dir / ".index",
            reranker_model=self.config.reranker_model if self.config.enable_reranker else None,
        )
        retriever.vector_store = self.store if self.store.postgres else None
        self.store.sync_vectors(retriever.chunks, retriever.vectors, retriever.version)
        return retriever

    def refresh(self) -> None:
        with self.reload_lock:
            current = self.store.list_documents()
            fingerprint = self.fingerprint(current)
            if fingerprint != self.document_fingerprint:
                self.retriever = self.build_index()
                self.document_fingerprint = fingerprint

    async def cached(self, key: str) -> str | None:
        if self.redis:
            try:
                value = await self.redis.get(key)
                return value.decode() if isinstance(value, bytes) else value
            except Exception:
                self.metrics["cache_errors"] += 1
        with self.cache_lock:
            item = self.cache.get(key)
            if item and item[0] > time.time():
                return item[1]
            self.cache.pop(key, None)
        return None

    async def put_cache(self, key: str, value: str) -> None:
        if self.redis:
            try:
                await self.redis.set(key, value, ex=self.config.cache_ttl)
                return
            except Exception:
                self.metrics["cache_errors"] += 1
        with self.cache_lock:
            if len(self.cache) >= 500:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = (time.time() + self.config.cache_ttl, value)

    async def answer(self, query: Query) -> Answer:
        start = time.perf_counter()
        await asyncio.to_thread(self.refresh)
        # Snapshot the index for the whole request, even while ingestion replaces it.
        retriever = self.retriever
        key = (
            "policylens:"
            + hashlib.sha256(
                (
                    "pipeline-v3:"
                    + query.model_dump_json()
                    + retriever.version
                    + self.config.provider
                    + self.config.ollama_model
                    + str(self.config.min_cosine)
                ).encode()
            ).hexdigest()
        )
        if query.use_cache and (value := await self.cached(key)):
            answer = Answer.model_validate_json(value)
            answer.request_id = str(uuid.uuid4())
            answer.cached = True
            answer.latency_ms = round((time.perf_counter() - start) * 1000, 2)
            self.metrics["cache_hits"] += 1
            self.record(answer)
            return answer
        route = classify(query.question, query.document_id)
        answer = Answer(
            request_id=str(uuid.uuid4()),
            status="abstained",
            answer="",
            route=route,
            provider=self.generator.name,
            strategy=query.strategy + ("+rerank" if query.rerank else ""),
            latency_ms=0,
            corpus_version=retriever.version,
        )
        messages = {
            "adversarial": "I cannot follow instructions that bypass source verification.",
            "out_of_scope": "This question is outside the contract collection.",
            "temporal": "This collection has no verified historical policy versions. I cannot establish that change.",
            "legal_advice": "I can locate contract wording, but cannot make a legal judgment.",
            "ambiguous": "Select a contract and name the clause or term you want to investigate.",
        }
        if route != "retrieve":
            answer.answer = messages[route]
            if route == "ambiguous":
                answer.status = "clarify"
        else:
            async with self.semaphore:
                evidence, elapsed = await asyncio.to_thread(retriever.search, query)
                answer.evidence, answer.retrieval_ms = evidence, round(elapsed, 2)
                answer.answer = "I could not find sufficiently supported evidence for this question. Try naming a specific clause."
                if evidence and max(e.dense_score for e in evidence) >= self.config.min_cosine:
                    try:
                        claims, usage = await self.generator.generate(query.question, evidence)
                    except Exception:
                        self.metrics["provider_errors"] += 1
                        answer.provider = "extractive_fallback"
                        claims, usage = await ExtractiveGenerator().generate(
                            query.question, evidence
                        )
                    if verify_claims(claims, evidence):
                        answer.status, answer.claims, answer.usage = "answered", claims, usage
                        answer.answer = "\n\n".join(f"{c.text} [{c.citation_id}]" for c in claims)
                    elif claims:
                        self.metrics["verification_rejections"] += 1
        answer.latency_ms = round((time.perf_counter() - start) * 1000, 2)
        self.record(answer)
        if query.use_cache:
            await self.put_cache(key, answer.model_dump_json())
        return answer

    def record(self, answer: Answer) -> None:
        self.recent_requests[answer.request_id] = time.time()
        if len(self.recent_requests) > 1000:
            self.recent_requests.pop(next(iter(self.recent_requests)))
        self.metrics["requests"] += 1
        self.metrics[answer.status] += 1
        self.latencies.append(answer.latency_ms)
        self.latencies = self.latencies[-1000:]
