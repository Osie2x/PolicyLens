# Understand and explain PolicyLens

This initial implementation was created with Codex assistance. Reviewing it is not
the same as independently designing every component. Use the walkthrough below to
build genuine ownership, then describe precisely the experiments and changes you made.

## A 30-second explanation

“PolicyLens is an evidence-first assistant for public contract documents. It combines
BM25 keyword retrieval with MiniLM semantic embeddings, optionally reranks the results,
and returns quotes with verifiable source offsets. I use a reproducible CUAD evaluation
slice to compare retrieval quality, citation alignment, refusals, and latency. The
interface makes both supporting evidence and failure cases visible.”

Use “I built” only after you understand the implementation and can defend your
choices. Do not claim you manually labelled the CUAD examples or trained the pretrained models.

## Read the code in this order

Start with [Follow one real contract query](QUERY_WALKTHROUGH.md) and `make trace`
for a small reproducible experiment before reading every subsystem.

1. `models.py`: what can a request and answer contain?
2. `ingestion.py`: how does a chunk map back to the exact source text?
3. `retrieval.py`: where do BM25 and cosine scores become ranked lists?
4. `generation.py`: how does a quote become a candidate claim? What does verification prove?
5. `service.py`: why do corpus version and pipeline revision belong in the cache key?
6. `api.py`: where are authentication, rate limiting, asynchronous work, and SSE handled?
7. `storage.py` and `worker.py`: how do ingestion jobs cross process boundaries?
8. `scripts/evaluate.py`: where do expert gold labels enter the system, and why only there?

## Questions to answer without looking

- Why would BM25 help with policy codes, party names, and exact dates?
- How does semantic search help when words differ, and when does it fail?
- Why does RRF combine ranks rather than add raw BM25 and cosine scores?
- What does a cross-encoder see that a bi-encoder does not? Why is it slower?
- Why does a perfect exact-quote score not imply a correct answer?
- How can an absent annotation produce a misleading refusal-quality score?
- Why is a warm sequential p95 different from p95 under concurrent load?
- Why must a response cache change when the corpus, retrieval settings, or generator changes?
- What can go wrong when a worker crashes after claiming a job?
- Which safeguards are tested, and which deployment paths remain unverified locally?

## Three independent exercises

**Trace one answer.** Pick a contract, ask a clause question, open its citation, and
locate the quoted text in the original export. Explain the offset and ID mapping
without reading this guide.

**Investigate one failure.** Open `reports/failures.json`. Determine whether the
problem begins in retrieval, quote selection, or an imperfect label. Record your
reasoning with the actual source passage. Do not call a lexical score a legal judgment.

**Make one measured change.** Use a separate development slice to tune chunk size or
quote selection. Freeze your choice, then evaluate on new contracts. Record code
revision, corpus/label checksums, quality change, and latency change. A reused tuning
suite cannot establish held-out generalization.

## Honest resume language

After understanding and independently extending the project:

- Developed a FastAPI and React evidence-search application combining BM25, MiniLM
  embeddings, reciprocal rank fusion, and optional cross-encoder reranking.
- Built a reproducible evaluation workflow using 200 expert-derived CUAD cases and
  40 programmatic controls, reporting retrieval, citation alignment, answer overlap,
  abstention, and CPU latency with case-level failure analysis.
- Implemented verified source quotations, asynchronous ingestion, cache invalidation,
  authentication, rate limiting, streaming, API tests, and containerized service definitions.

Add “deployed,” “improved,” exact results, or “production” only when your own receipts
and experiments support those claims. The actual measured results are in the README;
no improvement from an unmeasured baseline should appear on your resume.

## A good interview tradeoff answer

“Reranking improved evidence retrieval on this development slice, but increased CPU
p95 substantially. I kept it optional and exposed both quality and latency in the
dashboard. Caching helped repeated questions, but cache timing is a different workload
and does not remove the cost of new queries. I also separate exact quotation from
answer correctness, since the wrong quote can still be perfectly traceable.”
