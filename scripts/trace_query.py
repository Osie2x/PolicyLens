"""Trace one real public-contract query through an isolated, in-process HTTP app.

Uses the pretrained embedder, never the deterministic test double or evaluation labels.
Temporary SQLite/index files leave the regular API database and corpus untouched.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from policylens.api import create_app
from policylens.config import ROOT, Settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", default="cuad-001")
    parser.add_argument("--question", default="What does this contract say about governing law?")
    args = parser.parse_args()
    corpus = ROOT / "data/corpus.json"
    with TemporaryDirectory(prefix="policylens-trace-") as directory:
        data_dir = Path(directory)
        shutil.copyfile(corpus, data_dir / "corpus.json")
        config = Settings(
            _env_file=None,
            data_dir=data_dir,
            database_url="sqlite:///" + str(data_dir / "trace.db"),
            redis_url="",
            provider="extractive",
            embedding_model="sentence-transformers/all-MiniLM-L6-v2",
            enable_reranker=False,
            demo_mode=True,
            api_key="",
            admin_key="",
            min_cosine=0.30,
            rate_limit=30,
            cache_ttl=300,
        )
        with TestClient(create_app(config)) as client:
            query = {"question": args.question, "document_id": args.document_id}
            response = client.post("/api/query", json=query)
            response.raise_for_status()
            answer = response.json()
            original = client.get("/api/documents/" + args.document_id)
            original.raise_for_status()
            document = original.json()
            evidence = {e["chunk"]["id"]: e["chunk"] for e in answer["evidence"]}
            claims = []
            for claim in answer["claims"]:
                chunk = evidence[claim["citation_id"]]
                assert chunk["document_id"] == args.document_id
                assert document["text"][chunk["start"] : chunk["end"]] == chunk["text"]
                start = chunk["start"] + chunk["text"].index(claim["text"])
                end = start + len(claim["text"])
                assert document["text"][start:end] == claim["text"]
                claims.append({**claim, "source_start": start, "source_end": end})
            repeated = client.post("/api/query", json=query)
            repeated.raise_for_status()
            second = repeated.json()
            assert not answer["cached"] and second["cached"]
            assert second["request_id"] != answer["request_id"]
            assert second["claims"] == answer["claims"]
            report = {
                "query": query,
                "document_title": document["title"],
                "corpus_sha256": hashlib.sha256(corpus.read_bytes()).hexdigest(),
                "embedding_model": config.embedding_model,
                "route": answer["route"],
                "status": answer["status"],
                "provider": answer["provider"],
                "strategy": answer["strategy"],
                "corpus_version": answer["corpus_version"],
                "evidence_count": len(evidence),
                "claims_with_verified_offsets": claims,
                "first_latency_ms": answer["latency_ms"],
                "repeat_latency_ms": second["latency_ms"],
                "repeat_cached": second["cached"],
                "scope": "One query, temporary SQLite, real pretrained MiniLM, in-process HTTP",
                "limitations": "Exact source text does not prove relevance or completeness. "
                "Not a benchmark, concurrent load test, PostgreSQL test or deployed service.",
            }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
