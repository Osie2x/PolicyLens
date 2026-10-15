# Follow one real contract query

This first learning milestone was prepared with Codex assistance. It helps a user
inspect a public contract's wording and trace a quotation back to its source.
It does not establish legal correctness, independent authorship or user mastery.

## Run the small experiment

From the repository root, after installing `uv`:

```sh
uv sync --locked --extra dev --python 3.11
make trace
```

`scripts/trace_query.py` asks “What does this contract say about governing law?”
about `cuad-001`. It copies the existing public corpus into a temporary directory,
creates a temporary SQLite database and index, and uses real pretrained MiniLM
embeddings. The first run may download that model. It uses no paid API, evaluation
labels, synthetic contract fixture or test embedder. The temporary files are removed
afterward; your normal API database and index remain unchanged.

The script sends requests through FastAPI's in-process HTTP test client, so it
exercises validation and the endpoint without starting a network server. A real
browser, remote network and production deployment are outside this experiment.

It prints JSON: named fields and values that Python can read as a dictionary.
Look first at `status`, `route`, `claims_with_verified_offsets` and `repeat_cached`.
The script also checks that a repeated request has identical claims and a fresh
request ID. An unfamiliar question may correctly return no claims.

The [October 15 local receipt](../reports/query-trace-2026-10-15.json) returned
`answered`, five evidence passages and the governing-law quotation in
`cuad-001:34`. Its source range was `[21902:22102]`, containing the California
governing-law sentence. Source text and chunk offsets matched. The first service
request took 20.92 ms and its cached repeat took 2.26 ms, excluding model startup,
index creation and HTTP overhead. These are individual observations, not a
performance improvement claim. The local backend suite passed 19 tests; its two
external-service tests were skipped. Lint, formatting and backend type checks passed.

## Follow the actual files

1. **Request:** `backend/policylens/models.py`, `Query`, defines the input. A
   `document_id` selects one contract; `top_k` limits the returned passages.
   `backend/policylens/api.py`, `query_endpoint` and `run`, validate the contract
   ID and pass the request to the service. HTTP is the request/response interface;
   the endpoint is `POST /api/query`.
2. **Service and cache:** `backend/policylens/service.py`, `Service.answer`,
   refreshes the corpus index, keeps a request-local snapshot and builds a cache
   key from the query and pipeline configuration. A cache stores a previous
   response so a repeat can reuse it. The script's first request starts with an
   empty cache. `generation.py`, `classify`, chooses retrieval or an early refusal.
3. **Retrieval:** `backend/policylens/retrieval.py`, `Retriever.search`, limits
   eligible chunks to the selected document. BM25 ranks keyword matches; MiniLM
   vectors rank semantic similarity. The default hybrid strategy combines the
   ranks using reciprocal rank fusion, rather than adding incompatible raw scores.
   Even the BM25 strategy computes dense similarity for the shared refusal gate.
4. **Selection and verification:** `Service.answer` requires enough dense
   similarity before calling `generation.py`, `ExtractiveGenerator.generate`.
   That generator selects original text. `verify_claims` requires every claim to
   cite a retrieved chunk and appear there verbatim. No unverified claim is released
   by this route. An exact but irrelevant quotation can still pass this check.
5. **Response and source:** the API returns `Answer`. The script fetches the original
   document through `GET /api/documents/{id}`, checks each chunk's character range
   and locates each claim inside it. Source offsets are zero-based Python slice
   positions: the end is excluded. The repeat takes the response-cache path.

`ingestion.py`, `chunk_document`, creates those exact character ranges. Choosing
original slices preserves punctuation and whitespace; rebuilding strings from
tokens could break the source mapping.

## One real database failure

The original [October 10 backend check](https://github.com/Osie2x/PolicyLens/actions/runs/38057976724/job/114230235641)
failed in `Store.dense_ranking` in `backend/policylens/storage.py`. PostgreSQL could
not determine the type of the optional document parameter in this predicate:

```sql
:doc IS NULL OR document_id=:doc
```

When Python supplies `None`, the first expression gives PostgreSQL no concrete type
for the null value. SQL is the language used to ask a database for matching rows.
The fix supplies the type explicitly:

```sql
CAST(:doc AS text) IS NULL OR document_id=:doc
```

The value is still a bound parameter, so a document ID is data rather than SQL code.
An alternative is to maintain separate filtered and unfiltered query statements.
The explicit cast keeps the existing single statement and its sorting behavior.

The real pgvector integration test now checks unfiltered ordering, each document's
filter, an unknown document and an unknown corpus version. SQLite unit tests do not
execute PostgreSQL's parameter typing or pgvector operator; passing them alone
cannot verify this fix. The existing CI PostgreSQL service is the relevant check.
This unfiltered storage call is tested directly; the normal answer router still
asks the user to select a contract before answering.

## What to measure and what to avoid claiming

The trace prints a corpus checksum, index version, model name, quotation offsets,
and first/repeat request timings. A lower repeat time describes one cached request,
not a throughput benchmark or a performance improvement over the previous version.
Exact source matching demonstrates provenance, not answer relevance or completeness.
This milestone does not rerun the 240-case evaluation suite.

The October 10 frontend and image-build jobs passed. The separate
[preview deployment](https://github.com/Osie2x/PolicyLens/actions/runs/38057976765/job/114230319681)
failed with HTTP 404 and asked for GitHub Pages to be enabled. Building an image
does not show the whole service stack works, and building a preview does not mean
it is hosted. See [deployment instructions](DEPLOYMENT.md) for the Pages setting.

## Your 15-minute review

First explain what a request, a chunk and a citation ID are using this example.
Then trace one printed quotation back to the original document, explaining why its
offset is trustworthy.

**Interview question:** Why can every quotation match its source while the answer
is still wrong or incomplete? Name the additional check you would want.

**Independent exercise:** Extend the PostgreSQL test with a document ID containing
an apostrophe. Predict whether it should match a document and explain why a bound
parameter matters. Attempt the change before reading a worked solution. It counts
as learning evidence only after your own explanation and attempt.

Stay on this milestone until that review; test results and generated notes do not
demonstrate that you understand it.
