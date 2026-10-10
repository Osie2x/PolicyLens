"""Real pgvector integration tests, enabled in CI's isolated PostgreSQL service."""

import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from policylens.ingestion import chunk_document
from policylens.models import Document
from policylens.storage import Store

pytestmark = pytest.mark.skipif(
    not os.getenv("POLICYLENS_TEST_DATABASE_URL"),
    reason="PostgreSQL integration service not configured",
)


def test_pgvector_ranking_and_atomic_job_claim():
    store = Store(os.environ["POLICYLENS_TEST_DATABASE_URL"], [])
    docs = [
        Document(id="integration-a", title="A", text="alpha policy " * 15),
        Document(id="integration-b", title="B", text="beta policy " * 15),
    ]
    chunks = [chunk_document(d)[0] for d in docs]
    vectors = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
    store.sync_vectors(chunks, vectors, "integration-v1")
    results = store.dense_ranking(np.array([1, 0, 0]), "integration-v1", None)
    assert results[0][0] == chunks[0].id and results[0][1] == pytest.approx(1)
    assert len(store.dense_ranking(np.array([1, 0, 0]), "integration-v1", "integration-b")) == 1
    key = store.enqueue({"operation": "reindex"})
    with ThreadPoolExecutor(max_workers=2) as pool:
        claimed = list(pool.map(lambda _: store.claim_job(), range(2)))
    assert sum(c is not None and c["id"] == key for c in claimed) == 1
    store.finish_job(key)
    assert store.get_job(key)["status"] == "completed"
    store.engine.dispose()
