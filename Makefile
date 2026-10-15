.PHONY: install api web worker evaluate check compose trace
install:
	uv sync --locked --extra dev --python 3.11
	cd frontend && npm ci
api:
	uv run uvicorn policylens.api:app --host 127.0.0.1 --port 8000 --no-access-log
web:
	cd frontend && npm run dev
worker:
	uv run python -m policylens.worker
evaluate:
	OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=1 uv run python scripts/evaluate.py --rerank
trace:
	uv run python scripts/trace_query.py
check:
	uv run ruff check backend scripts
	uv run ruff format --check backend scripts
	uv run mypy backend/policylens
	uv run pytest -q
	cd frontend && npm run build
compose:
	docker compose up --build
