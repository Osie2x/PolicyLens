"""Offline evaluation; gold spans are used only by the scorer, never the answer engine."""

import argparse
import asyncio
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from policylens.config import Settings
from policylens.models import Query
from policylens.service import Service

ROOT = Path(__file__).resolve().parents[1]


def terms(text):
    return re.findall(r"\w+", text.lower())


def f1(prediction, reference):
    p, r = Counter(terms(prediction)), Counter(terms(reference))
    shared = sum((p & r).values())
    if not shared:
        return 0.0
    precision, recall = shared / max(1, sum(p.values())), shared / max(1, sum(r.values()))
    return 2 * precision * recall / (precision + recall)


def relevant(chunk, spans):
    return any(
        max(0, min(chunk.end, a["end"]) - max(chunk.start, a["start"]))
        >= min(80, (a["end"] - a["start"]) * 0.5)
        for a in spans
    )


async def evaluate(rerank=False):
    config = Settings(
        enable_reranker=rerank,
        database_url="sqlite:///" + str(ROOT / ".runtime/evaluation.db"),
        rate_limit=10000,
    )
    service = Service(config)
    rows = json.loads((ROOT / "data/evaluation.json").read_text())
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "corpus_version": service.retriever.version,
        "documents": len(service.retriever.documents),
        "chunks": len(service.retriever.chunks),
        "questions": len(rows),
        "embedding_model": config.embedding_model,
        "reranker_model": config.reranker_model if rerank else None,
        "provider": config.provider,
        "chunk_words": 120,
        "overlap_words": 24,
        "seed": 42,
        "scope": "contract-scoped, warm model, uncached requests, CPU; development suite",
        "code_sha256": hashlib.sha256(
            b"".join(p.read_bytes() for p in sorted((ROOT / "backend/policylens").glob("*.py")))
        ).hexdigest(),
        "corpus_sha256": hashlib.sha256((ROOT / "data/corpus.json").read_bytes()).hexdigest(),
        "labels_sha256": hashlib.sha256((ROOT / "data/evaluation.json").read_bytes()).hexdigest(),
        "limitations": [
            "240 cases = 200 expert-derived CUAD labels + 40 repeated programmatic controls.",
            "Recall@5 is any gold-span evidence hit; span recall counts all annotated spans.",
            "Token F1 is a lexical overlap proxy, not human-scored answer correctness.",
            "Groundedness measures exact quotation only; it does not measure relevance or completeness.",
            "Absent annotations are an imperfect abstention target.",
            "No multi-document reasoning or independently labelled temporal suite.",
            "p99 from 240 sequential warm requests is not a production load test.",
        ],
        "runs": [],
    }
    variants = [("bm25", False), ("dense", False), ("hybrid", False)]
    if rerank:
        variants.append(("hybrid", True))
    failures = []
    examples = []
    for strategy, rerank_enabled in variants:
        name = strategy + ("+rerank" if rerank_enabled else "")
        outcomes, positive, times = [], [], []
        for index, row in enumerate(rows):
            query = Query(
                question=row["question"],
                document_id=row["document_id"],
                strategy=strategy,
                rerank=rerank_enabled,
                use_cache=False,
            )
            result = await service.answer(query)
            evidence = result.evidence
            relevant_chunks = {
                c.id
                for c in service.retriever.chunks
                if c.document_id == row["document_id"] and relevant(c, row["answers"])
            }
            ranks = [i + 1 for i, e in enumerate(evidence) if e.chunk.id in relevant_chunks]
            retrieval_hit = bool(ranks)
            span_hits = sum(any(relevant(e.chunk, [a]) for e in evidence) for a in row["answers"])
            dcg = sum(1 / math.log2(i + 1) for i in ranks)
            ideal = sum(1 / math.log2(i + 1) for i in range(1, min(5, len(relevant_chunks)) + 1))
            predicted = "\n".join(c.text for c in result.claims)
            overlap_f1 = max((f1(predicted, a["text"]) for a in row["answers"]), default=0)
            cited_ids = {c.citation_id for c in result.claims}
            citation_span_hits = sum(
                any(relevant(e.chunk, [a]) for e in evidence if e.chunk.id in cited_ids)
                for a in row["answers"]
            )
            citation_hits = sum(c.citation_id in relevant_chunks for c in result.claims)
            citation_precision = citation_hits / len(result.claims) if result.claims else None
            refused = result.status != "answered"
            correct_refusal = refused == row["should_abstain"]
            outcome = {
                "id": row["id"],
                "category": row["category"],
                "strategy": name,
                "retrieval_hit": retrieval_hit,
                "mrr": 1 / ranks[0] if ranks else 0,
                "ndcg": dcg / ideal if ideal else 0,
                "span_recall": span_hits / len(row["answers"]) if row["answers"] else None,
                "token_f1": overlap_f1,
                "citation_precision": citation_precision,
                "citation_span_recall": citation_span_hits / len(row["answers"])
                if row["answers"]
                else None,
                "refusal_correct": correct_refusal,
                "status": result.status,
                "latency_ms": result.latency_ms,
                "quote_grounded": all(
                    c.text in next(e.chunk.text for e in evidence if e.chunk.id == c.citation_id)
                    for c in result.claims
                ),
            }
            outcomes.append(outcome)
            times.append(result.latency_ms)
            if row["answers"]:
                positive.append(outcome)
            failure = None
            if row["answers"] and not retrieval_hit:
                failure = "retrieval_miss"
            elif not correct_refusal:
                failure = "false_refusal" if refused else "unsupported_answer"
            elif result.claims and citation_precision == 0:
                failure = "citation_mismatch"
            elif row["answers"] and overlap_f1 < 0.2:
                failure = "answer_incomplete"
            if failure:
                failures.append(
                    {
                        "strategy": name,
                        "class": failure,
                        "id": row["id"],
                        "question": row["question"],
                        "document_id": row["document_id"],
                        "token_f1": overlap_f1,
                        "status": result.status,
                    }
                )
            if (
                name == "hybrid"
                and len(examples) < 6
                and result.status == "answered"
                and citation_precision
                and overlap_f1 > 0.15
            ):
                examples.append(
                    {
                        "question": query.question,
                        "document_id": query.document_id,
                        "answer": result.model_dump(),
                    }
                )
            if (index + 1) % 40 == 0:
                print(f"{name}: {index + 1}/{len(rows)}", flush=True)
        cited = [o["citation_precision"] for o in positive if o["citation_precision"] is not None]
        negative = [o for o in outcomes if o["category"] == "absent_clause"]
        control = [
            o for o in outcomes if o["category"] not in ("direct_retrieval", "absent_clause")
        ]
        run = {
            "name": name,
            "n": len(outcomes),
            "positive_n": len(positive),
            "recall_at_5": float(np.mean([o["retrieval_hit"] for o in positive])),
            "mrr": float(np.mean([o["mrr"] for o in positive])),
            "ndcg_at_5": float(np.mean([o["ndcg"] for o in positive])),
            "gold_span_recall_at_5": float(np.mean([o["span_recall"] for o in positive])),
            "answer_token_f1": float(np.mean([o["token_f1"] for o in positive])),
            "citation_precision": float(np.mean(cited)) if cited else None,
            "citation_precision_n": len(cited),
            "citation_gold_span_recall": float(
                np.mean([o["citation_span_recall"] for o in positive])
            ),
            "quote_groundedness": float(
                np.mean([o["quote_grounded"] for o in outcomes if o["status"] == "answered"])
            ),
            "answer_coverage": float(np.mean([o["status"] == "answered" for o in positive])),
            "abstention_accuracy": float(np.mean([o["refusal_correct"] for o in outcomes])),
            "absent_clause_refusal": float(np.mean([o["refusal_correct"] for o in negative])),
            "control_refusal": float(np.mean([o["refusal_correct"] for o in control])),
            "latency_ms": {f"p{n}": round(float(np.percentile(times, n)), 2) for n in [50, 95, 99]},
            "failure_counts": dict(Counter(f["class"] for f in failures if f["strategy"] == name)),
            "exceptions": 0,
            "generation_tokens": 0,
            "generation_cost_usd": 0,
        }
        report["runs"].append(run)
        (ROOT / "reports" / f"{name.replace('+', '-')}-cases.json").write_text(
            json.dumps(outcomes, indent=2)
        )
        print(json.dumps(run, indent=2), flush=True)
    if examples:
        query = Query(question=examples[0]["question"], document_id=examples[0]["document_id"])
        await service.answer(query)
        cached_times = [(await service.answer(query)).latency_ms for _ in range(20)]
        report["cached_latency_ms"] = {
            f"p{n}": round(float(np.percentile(cached_times, n)), 2) for n in [50, 95, 99]
        }
        report["cache_sample_n"] = 20
    (ROOT / "reports/benchmark.json").write_text(json.dumps(report, indent=2))
    (ROOT / "reports/failures.json").write_text(json.dumps(failures, indent=2))
    (ROOT / "frontend/public/demo.json").write_text(
        json.dumps(
            {
                "documents": [d.model_dump() for d in service.retriever.documents],
                "report": report,
                "failures": failures,
                "examples": examples,
            }
        )
    )
    print("Saved benchmark, individual case results, failures, and offline preview.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerank", action="store_true")
    asyncio.run(evaluate(parser.parse_args().rerank))
