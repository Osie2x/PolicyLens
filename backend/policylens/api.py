import asyncio
import hashlib
import json
import logging
import secrets
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings, settings
from .models import Answer, Feedback, IngestRequest, Query
from .service import Service

log = logging.getLogger("policylens")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def create_app(config: Settings = settings, injected: Service | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not config.demo_mode and (not config.api_key or not config.admin_key):
            raise RuntimeError("Production requires API and admin keys")
        app.state.service = injected or await asyncio.to_thread(Service, config)
        yield
        if app.state.service.redis:
            await app.state.service.redis.aclose()
        app.state.service.store.engine.dispose()

    app = FastAPI(
        title="PolicyLens API",
        version="0.1.0",
        lifespan=lifespan,
        description="Evidence retrieval. Exact quotation checks are not semantic entailment.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key", "X-Admin-Key"],
    )
    buckets: dict[str, deque[float]] = defaultdict(deque)

    def service(request: Request) -> Service:
        return request.app.state.service

    async def authorize(request: Request, x_api_key: str = Header(default="")) -> None:
        if config.api_key and not secrets.compare_digest(x_api_key, config.api_key):
            raise HTTPException(401, "Invalid API key")
        identity = hashlib.sha256(
            (x_api_key or (request.client.host if request.client else "local")).encode()
        ).hexdigest()
        svc = service(request)
        if svc.redis:
            try:
                # Atomic counter+expiry; no immortal keys after a worker crash.
                count = await svc.redis.eval(
                    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
                    1,
                    "rate:" + identity + ":" + str(int(time.time() // 60)),
                )
                if count > config.rate_limit:
                    raise HTTPException(429, "Rate limit exceeded", headers={"Retry-After": "60"})
                return
            except HTTPException:
                raise
            except Exception:
                svc.metrics["rate_store_errors"] += 1
        now = time.monotonic()
        if len(buckets) > 10000:
            for key in list(buckets):
                if not buckets[key] or buckets[key][-1] < now - 60:
                    del buckets[key]
        bucket = buckets[identity]
        while bucket and bucket[0] < now - 60:
            bucket.popleft()
        if len(bucket) >= config.rate_limit:
            raise HTTPException(429, "Rate limit exceeded", headers={"Retry-After": "60"})
        bucket.append(now)

    async def admin(x_admin_key: str = Header(default="")) -> None:
        if not config.admin_key or not secrets.compare_digest(x_admin_key, config.admin_key):
            raise HTTPException(403, "Admin key required; ingestion is disabled in the public demo")

    @app.middleware("http")
    async def trace(request: Request, call_next: Any):
        trace_id = str(uuid.uuid4())
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        log.info(
            json.dumps(
                {
                    "trace_id": trace_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                }
            )
        )
        return response

    @app.get("/health")
    async def health(request: Request):
        svc = service(request)
        dependencies = {"database": "ok", "redis": "not_configured"}
        try:
            await asyncio.to_thread(svc.store.list_documents)
        except Exception:
            raise HTTPException(503, "Database unavailable")
        if svc.redis:
            try:
                await svc.redis.ping()
                dependencies["redis"] = "ok"
            except Exception:
                dependencies["redis"] = "degraded_local_fallback"
        return {
            "status": "ok",
            "dependencies": dependencies,
            "corpus_version": svc.retriever.version,
            "embedding_model": config.embedding_model,
            "provider": config.provider,
            "reranker_enabled": config.enable_reranker,
            "demo_mode": config.demo_mode,
        }

    @app.get("/api/documents", dependencies=[Depends(authorize)])
    async def list_documents(request: Request):
        svc = service(request)
        await asyncio.to_thread(svc.refresh)
        return [
            {
                **d.model_dump(exclude={"text"}),
                "characters": len(d.text),
                "chunks": sum(c.document_id == d.id for c in svc.retriever.chunks),
            }
            for d in svc.retriever.documents
        ]

    @app.get("/api/documents/{document_id}", dependencies=[Depends(authorize)])
    async def get_document(document_id: str, request: Request):
        for doc in service(request).retriever.documents:
            if doc.id == document_id:
                return doc
        raise HTTPException(404, "Document not found")

    async def run(query: Query, svc: Service) -> Answer:
        if query.document_id and not any(
            d.id == query.document_id for d in svc.store.list_documents()
        ):
            raise HTTPException(404, "Document not found")
        if query.rerank and not config.enable_reranker:
            raise HTTPException(422, "Reranking is not enabled on this server")
        try:
            return await asyncio.wait_for(svc.answer(query), timeout=config.request_timeout)
        except asyncio.TimeoutError:
            svc.metrics["timeouts"] += 1
            raise HTTPException(504, "Request timed out; try again with reranking disabled")

    @app.post("/api/query", response_model=Answer, dependencies=[Depends(authorize)])
    async def query_endpoint(query: Query, request: Request):
        return await run(query, service(request))

    @app.post("/api/query/stream", dependencies=[Depends(authorize)])
    async def stream(query: Query, request: Request):
        # Phase events are real. Claims are released only after full verification.
        svc = service(request)
        if query.rerank and not config.enable_reranker:
            raise HTTPException(422, "Reranking is not enabled on this server")

        async def events():
            yield 'event: phase\ndata: {"phase":"retrieving_and_verifying"}\n\n'
            try:
                result = await run(query, svc)
                for claim in result.claims:
                    yield f"event: claim\ndata: {claim.model_dump_json()}\n\n"
                yield f"event: answer\ndata: {result.model_dump_json()}\n\n"
            except HTTPException as error:
                yield (
                    "event: error\ndata: "
                    + json.dumps({"detail": error.detail, "status": error.status_code})
                    + "\n\n"
                )

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/feedback", dependencies=[Depends(authorize)])
    async def save_feedback(item: Feedback, request: Request):
        svc = service(request)
        if item.request_id not in svc.recent_requests:
            raise HTTPException(404, "Request not found in this server session")
        return {
            "id": await asyncio.to_thread(svc.store.add_feedback, item.request_id, item.rating),
            "saved": True,
        }

    @app.get("/api/experiments", dependencies=[Depends(authorize)])
    async def experiments():
        report = config.data_dir.parent / "reports/benchmark.json"
        return (
            json.loads(report.read_text()) if report.exists() else {"runs": [], "status": "not_run"}
        )

    @app.get("/api/metrics", dependencies=[Depends(authorize)])
    async def metrics(request: Request):
        svc = service(request)
        return {
            "counters": dict(svc.metrics),
            "latency_ms": {
                f"p{n}": round(float(np.percentile(svc.latencies, n)), 2) if svc.latencies else None
                for n in [50, 95, 99]
            },
            "window": len(svc.latencies),
            "scope": "this API process; latest 1000 requests",
        }

    @app.post("/api/ingestion", status_code=202, dependencies=[Depends(admin)])
    async def ingestion(payload: IngestRequest, request: Request):
        return {
            "job_id": await asyncio.to_thread(service(request).store.enqueue, payload.model_dump())
        }

    @app.post("/api/ingestion/pdf", status_code=202, dependencies=[Depends(admin)])
    async def ingest_pdf(request: Request, file: UploadFile = File()):
        import base64

        content = await file.read(2_000_001)
        if len(content) > 2_000_000:
            raise HTTPException(413, "PDF limit is 2 MB")
        if not content.startswith(b"%PDF-"):
            raise HTTPException(415, "Expected a PDF")
        payload = {
            "title": (file.filename or "Uploaded PDF")[:200],
            "pdf_base64": base64.b64encode(content).decode(),
            "version": "1",
        }
        return {"job_id": await asyncio.to_thread(service(request).store.enqueue, payload)}

    @app.post("/api/reindex", status_code=202, dependencies=[Depends(admin)])
    async def reindex(request: Request):
        return {
            "job_id": await asyncio.to_thread(
                service(request).store.enqueue, {"operation": "reindex"}
            )
        }

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(admin)])
    async def job(job_id: str, request: Request):
        result = await asyncio.to_thread(service(request).store.get_job, job_id)
        if result is None:
            raise HTTPException(404, "Job not found")
        return result

    return app


app = create_app()
