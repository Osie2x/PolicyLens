import json
import time
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import Column, Float, MetaData, String, Table, Text, create_engine, select, text

from .models import Chunk, Document

metadata = MetaData()
documents = Table(
    "documents", metadata, Column("id", String, primary_key=True), Column("payload", Text)
)
feedback = Table(
    "feedback",
    metadata,
    Column("id", String, primary_key=True),
    Column("request_id", String),
    Column("rating", String),
    Column("created_at", Float),
)
jobs = Table(
    "jobs",
    metadata,
    Column("id", String, primary_key=True),
    Column("status", String),
    Column("payload", Text),
    Column("error", String),
    Column("created_at", Float),
    Column("updated_at", Float),
)


class Store:
    def __init__(self, url: str, seed: list[Document]):
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, pool_pre_ping=True)
        metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            if seed and not conn.execute(select(documents.c.id).limit(1)).first():
                conn.execute(
                    documents.insert(), [{"id": d.id, "payload": d.model_dump_json()} for d in seed]
                )
        self.postgres = self.engine.dialect.name == "postgresql"
        if self.postgres:
            with self.engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS embeddings "
                        "(id TEXT PRIMARY KEY, document_id TEXT, corpus_version TEXT, embedding vector)"
                    )
                )

    def list_documents(self) -> list[Document]:
        with self.engine.connect() as conn:
            return [
                Document.model_validate_json(row.payload) for row in conn.execute(select(documents))
            ]

    def put_document(self, doc: Document) -> None:
        with self.engine.begin() as conn:
            conn.execute(documents.delete().where(documents.c.id == doc.id))
            conn.execute(documents.insert().values(id=doc.id, payload=doc.model_dump_json()))

    def add_feedback(self, request_id: str, rating: str) -> str:
        key = str(uuid.uuid4())
        with self.engine.begin() as conn:
            conn.execute(
                feedback.insert().values(
                    id=key, request_id=request_id, rating=rating, created_at=time.time()
                )
            )
        return key

    def enqueue(self, payload: dict[str, Any]) -> str:
        key = str(uuid.uuid4())
        with self.engine.begin() as conn:
            conn.execute(
                jobs.insert().values(
                    id=key,
                    status="queued",
                    payload=json.dumps(payload),
                    created_at=time.time(),
                    updated_at=time.time(),
                )
            )
        return key

    def get_job(self, key: str) -> dict[str, Any] | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(jobs).where(jobs.c.id == key)).mappings().first()
            return (
                {k: row[k] for k in ("id", "status", "error", "created_at", "updated_at")}
                if row
                else None
            )

    def claim_job(self) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            statement = (
                select(jobs).where(jobs.c.status == "queued").order_by(jobs.c.created_at).limit(1)
            )
            if self.postgres:
                statement = statement.with_for_update(skip_locked=True)
            row = conn.execute(statement).mappings().first()
            if not row:
                return None
            result = conn.execute(
                jobs.update()
                .where(jobs.c.id == row["id"], jobs.c.status == "queued")
                .values(status="running", updated_at=time.time())
            )
            if result.rowcount != 1:
                return None
            return dict(row)

    def finish_job(self, key: str, error: str | None = None) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                jobs.update()
                .where(jobs.c.id == key)
                .values(
                    status="failed" if error else "completed", error=error, updated_at=time.time()
                )
            )

    def sync_vectors(self, chunks: list[Chunk], vectors: Any, version: str) -> None:
        if not self.postgres:
            return
        with self.engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(918472)"))
            count = conn.execute(
                text("SELECT count(*) FROM embeddings WHERE corpus_version=:v"), {"v": version}
            ).scalar()
            if count == len(chunks):
                return
            # Multiple corpus versions allow in-flight requests to retain a consistent snapshot.
            conn.execute(text("DELETE FROM embeddings WHERE corpus_version=:v"), {"v": version})
            conn.execute(
                text(
                    "INSERT INTO embeddings(id,document_id,corpus_version,embedding) "
                    "VALUES (:id,:doc,:v,CAST(:embedding AS vector)) ON CONFLICT(id) "
                    "DO UPDATE SET embedding=EXCLUDED.embedding, corpus_version=EXCLUDED.corpus_version"
                ),
                [
                    {
                        "id": version + ":" + c.id,
                        "doc": c.document_id,
                        "v": version,
                        "embedding": json.dumps(vector.tolist()),
                    }
                    for c, vector in zip(chunks, vectors)
                ],
            )

    def dense_ranking(
        self, vector: Any, version: str, document_id: str | None
    ) -> list[tuple[str, float]]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, 1-(embedding <=> CAST(:q AS vector)) AS score "
                    "FROM embeddings WHERE corpus_version=:v "
                    "AND (:doc IS NULL OR document_id=:doc) "
                    "ORDER BY embedding <=> CAST(:q AS vector),id LIMIT 20"
                ),
                {"q": json.dumps(vector.tolist()), "v": version, "doc": document_id},
            )
            return [(row.id.removeprefix(version + ":"), float(row.score)) for row in rows]
