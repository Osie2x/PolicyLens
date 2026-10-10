import hashlib
import json

import numpy as np
import pytest
from policylens.config import Settings
from policylens.models import Document
from policylens.retrieval import tokens
from policylens.service import Service


class TestEmbedder:
    """Deterministic test double; never advertised as semantic embedding."""

    name = "test-only-hash"

    def encode(self, texts):
        vectors = np.zeros((len(texts), 64), dtype=np.float32)
        for i, text in enumerate(texts):
            for term in tokens(text):
                vectors[i, int(hashlib.sha256(term.encode()).hexdigest()[:4], 16) % 64] += 1
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-8)


@pytest.fixture
def svc(tmp_path):
    document = Document(
        id="policy-1",
        title="Travel policy",
        text=(
            "Travel reimbursements require receipts. Employees must submit receipts within thirty days. "
            "Manager approval is required before travel. Reimbursements exclude personal expenses. "
        )
        * 10,
        sha256="fixture-v1",
        version="2026",
    )
    (tmp_path / "corpus.json").write_text(json.dumps([document.model_dump()]))
    config = Settings(
        data_dir=tmp_path,
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        min_cosine=0.1,
        rate_limit=100,
        admin_key="admin-test",
        api_key="api-test",
    )
    return Service(config, TestEmbedder())
