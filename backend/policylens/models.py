from typing import Literal

from pydantic import BaseModel, Field


class Document(BaseModel):
    id: str
    title: str
    text: str
    version: str = "1"
    date: str | None = None
    page: int | None = None
    source_url: str = ""
    sha256: str = ""


class Chunk(BaseModel):
    id: str
    document_id: str
    title: str
    text: str
    start: int
    end: int
    section: str
    page: int | None = None
    date: str | None = None
    version: str
    source_url: str


class Query(BaseModel):
    question: str = Field(min_length=3, max_length=1500)
    document_id: str | None = None
    strategy: Literal["bm25", "dense", "hybrid"] = "hybrid"
    rerank: bool = False
    top_k: int = Field(default=5, ge=1, le=10)
    use_cache: bool = True


class Evidence(BaseModel):
    chunk: Chunk
    score: float
    lexical_score: float
    dense_score: float


class Claim(BaseModel):
    text: str
    citation_id: str


class Answer(BaseModel):
    request_id: str
    status: Literal["answered", "abstained", "clarify"]
    answer: str
    claims: list[Claim] = []
    evidence: list[Evidence] = []
    route: str
    provider: str
    strategy: str
    cached: bool = False
    latency_ms: float
    retrieval_ms: float = 0
    verification: str = "exact_quote"
    corpus_version: str
    usage: dict[str, int] = {}


class Feedback(BaseModel):
    request_id: str = Field(min_length=32, max_length=36, pattern=r"^[a-f0-9-]+$")
    rating: Literal["correct", "partial", "incorrect"]


class IngestRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=100, max_length=200000)
    version: str = Field(default="1", max_length=100)
    source_url: str = Field(default="", max_length=1000)
