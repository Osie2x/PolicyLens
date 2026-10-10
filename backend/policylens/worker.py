"""Separate ingestion/reindex worker. PostgreSQL jobs support multiple workers."""

import base64
import io
import json
import logging
import time
import uuid

from pypdf import PdfReader

from .config import settings
from .ingestion import content_hash
from .models import Document
from .service import Service


def process_job(service: Service, payload: dict) -> None:
    if payload.get("operation") == "reindex":
        service.retriever = service.build_index()
        return
    if "pdf_base64" in payload:
        reader = PdfReader(io.BytesIO(base64.b64decode(payload.pop("pdf_base64"))))
        if reader.is_encrypted or len(reader.pages) > 100:
            raise ValueError("Encrypted PDFs or more than 100 pages are unsupported")
        payload["text"] = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if not 100 <= len(payload.get("text", "")) <= 200000:
        raise ValueError("Parsed document must contain 100–200000 characters")
    document = Document(
        id="uploaded-" + str(uuid.uuid4()), sha256=content_hash(payload["text"]), **payload
    )
    service.store.put_document(document)
    service.refresh()


def main() -> None:
    service = Service(settings)
    logging.info("Ingestion worker ready")
    while True:
        job = service.store.claim_job()
        if job is None:
            time.sleep(2)
            continue
        try:
            process_job(service, json.loads(job["payload"]))
            service.store.finish_job(job["id"])
        except Exception as error:
            # Log only error class. Document bodies, filenames, and user questions stay out of logs.
            logging.error(json.dumps({"job_id": job["id"], "error_type": type(error).__name__}))
            service.store.finish_job(job["id"], type(error).__name__)


if __name__ == "__main__":
    main()
