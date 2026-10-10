import hashlib
import re

from .models import Chunk, Document


def chunk_document(document: Document, size: int = 120, overlap: int = 24) -> list[Chunk]:
    """Word windows preserve exact character offsets and source text; no gold labels used."""
    if not 0 <= overlap < size:
        raise ValueError("Overlap must be smaller than window size")
    words = list(re.finditer(r"\S+", document.text))
    chunks = []
    for index, position in enumerate(range(0, len(words), size - overlap)):
        start = words[position].start()
        end = words[min(position + size, len(words)) - 1].end()
        text = document.text[start:end]
        chunks.append(
            Chunk(
                id=f"{document.id}:{index}",
                document_id=document.id,
                title=document.title,
                text=text,
                start=start,
                end=end,
                section=f"Text window {index + 1}",
                page=document.page,
                date=document.date,
                version=document.version,
                source_url=document.source_url,
            )
        )
        if position + size >= len(words):
            break
    return chunks


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
