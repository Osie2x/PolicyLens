# Run and deploy

## Verified local route

Requires Python 3.11+ and Node 20.19+ / 22.12+.

```sh
uv sync --locked --extra dev --python 3.11
uv run uvicorn policylens.api:app --host 127.0.0.1 --port 8000 --no-access-log
# In a second terminal:
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. First startup downloads the MiniLM model and computes
1,726 passage embeddings. No paid API key is needed for the extractive default.
To enable reranking, set `POLICYLENS_ENABLE_RERANKER=true` before API startup.

For admin ingestion, set a random `POLICYLENS_ADMIN_KEY` in an uncommitted `.env`,
start `uv run python -m policylens.worker` from the same project directory, and enter
the admin key in Connection settings. Jobs are queued first; “queued” is not indexed.
Refresh the job status and verify the document appears before claiming completion.

## Optional local model

Install Ollama through its official distribution, run `ollama pull llama3.2:3b`, and
set `POLICYLENS_PROVIDER=ollama`. The adapter points to
`POLICYLENS_OLLAMA_URL=http://localhost:11434` by default. Provider errors fall back
to extractive selection; the response identifies the fallback. The benchmark uses
extractive generation, not Ollama. The local LLM path has not been exercised with a
running Ollama service on the build machine.

## Docker service topology

Docker is not installed on the build machine, so the Compose stack and Docker images
are supplied but **not locally runtime-verified**. CI contains image-build checks
and a real pgvector integration test. Do not call CI green until its run passes.

```sh
cp .env.example .env
# Replace the example database password with a random URL-safe password.
# For authenticated service mode, set DEMO_MODE=false and both API/admin keys.
docker compose up --build
```

Open http://localhost:8080. API, worker, PostgreSQL/pgvector, Redis, and nginx web UI
run separately. Database/cache ports are not exposed. Model/index/data volumes persist
across restarts. The web port is bound to loopback by default.

For a remote environment, provision separate API, worker, managed PostgreSQL with
pgvector, Redis, and web services. Change the nginx upstream for that environment.
Use HTTPS, platform secret storage, backups, explicit trusted-proxy settings, health
checks, and read-only demo keys. The repository does not provision cloud infrastructure,
purchase hosting, or certify the application as production-ready.

## Safe public preview

The `pages.yml` workflow builds a **read-only static preview**. It includes actual
saved answers, public source documents, and measured benchmark results. It cannot
perform live dense retrieval or save feedback. The UI labels this state explicitly.

After creating the GitHub repository, select **Settings → Pages → Source → GitHub
Actions**. A successful workflow deployment is the receipt for the public URL.
Do not claim the preview is deployed before that receipt exists.

A full live public deployment is a separate step requiring a configured host and
services. The static preview is deliberately useful without exposing ingestion,
private files, or a paid model credential.
