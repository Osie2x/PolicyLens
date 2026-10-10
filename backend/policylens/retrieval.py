import hashlib
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from rank_bm25 import BM25Okapi  # type: ignore[import-untyped]

from .ingestion import chunk_document
from .models import Chunk, Document, Evidence, Query

STOP = set(
    "the a an is are this that what does say about contract of to and in for be by with".split()
)


def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP]


class Embedder(Protocol):
    name: str

    def encode(self, texts: list[str]) -> np.ndarray: ...


class SentenceEmbedder:
    def __init__(self, name: str):
        from sentence_transformers import SentenceTransformer

        self.name = name
        self.model = SentenceTransformer(name, device="cpu")
        self.lock = threading.Lock()

    def encode(self, texts: list[str]) -> np.ndarray:
        with self.lock:
            return self.model.encode(
                texts,
                normalize_embeddings=True,
                batch_size=64,
                show_progress_bar=False,
                convert_to_numpy=True,
            )


def reciprocal_rank_fusion(rankings: list[list[int]], constant: int = 60) -> dict[int, float]:
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, 1):
            scores[item] = scores.get(item, 0) + 1 / (constant + rank)
    return scores


class Retriever:
    def __init__(
        self,
        documents: list[Document],
        embedder: Embedder,
        cache_dir: Path,
        size: int = 120,
        overlap: int = 24,
        reranker_model: str | None = None,
    ):
        self.documents = documents
        self.chunks: list[Chunk] = [c for d in documents for c in chunk_document(d, size, overlap)]
        if not self.chunks:
            raise ValueError("Cannot index an empty corpus")
        self.embedder = embedder
        payload = json.dumps([c.model_dump() for c in self.chunks], sort_keys=True)
        self.version = hashlib.sha256((payload + embedder.name).encode()).hexdigest()[:16]
        self.bm25 = BM25Okapi([tokens(c.text) or ["_empty_"] for c in self.chunks])
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{self.version}.npy"
        if path.exists():
            self.vectors = np.load(path, allow_pickle=False)
        else:
            self.vectors = embedder.encode([c.text for c in self.chunks])
            temporary = path.with_suffix(f".{uuid.uuid4().hex}.npy")
            np.save(temporary, self.vectors)
            temporary.replace(path)
        self.vector_store: Any = None
        self.reranker = None
        self.rerank_lock = threading.Lock()
        if reranker_model:
            from sentence_transformers import CrossEncoder

            self.reranker = CrossEncoder(reranker_model, device="cpu")

    def search(self, query: Query) -> tuple[list[Evidence], float]:
        start = time.perf_counter()
        eligible = np.array(
            [
                i
                for i, c in enumerate(self.chunks)
                if query.document_id is None or c.document_id == query.document_id
            ]
        )
        if not len(eligible):
            return [], (time.perf_counter() - start) * 1000
        lexical = self.bm25.get_scores(tokens(query.question))
        vector = self.embedder.encode([query.question])[0]
        dense = self.vectors @ vector
        rank_bm = sorted(eligible.tolist(), key=lambda i: (-float(lexical[i]), i))[:20]
        rank_dense = sorted(eligible.tolist(), key=lambda i: (-float(dense[i]), i))[:20]
        if self.vector_store is not None:
            remote = self.vector_store.dense_ranking(vector, self.version, query.document_id)
            indices = {c.id: i for i, c in enumerate(self.chunks)}
            rank_dense = [indices[cid] for cid, _ in remote]
            for cid, score in remote:
                dense[indices[cid]] = score
        if query.strategy == "bm25":
            scores = {i: float(lexical[i]) for i in rank_bm}
        elif query.strategy == "dense":
            scores = {i: float(dense[i]) for i in rank_dense}
        else:
            scores = reciprocal_rank_fusion([rank_bm, rank_dense])
        ranking = sorted(scores, key=lambda i: (-scores[i], i))[:20]
        if query.rerank:
            if self.reranker is None:
                raise ValueError("Reranking is disabled on this server")
            with self.rerank_lock:
                predicted = self.reranker.predict(
                    [(query.question, self.chunks[i].text) for i in ranking]
                )
            scores = dict(zip(ranking, map(float, predicted)))
            ranking.sort(key=lambda i: (-scores[i], i))
        evidence = [
            Evidence(
                chunk=self.chunks[i],
                score=round(scores[i], 6),
                lexical_score=round(float(lexical[i]), 4),
                dense_score=round(float(dense[i]), 4),
            )
            for i in ranking[: query.top_k]
        ]
        return evidence, (time.perf_counter() - start) * 1000
