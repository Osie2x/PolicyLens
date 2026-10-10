from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POLICYLENS_", env_file=".env", extra="ignore")
    data_dir: Path = ROOT / "data"
    database_url: str = "sqlite:///" + str(ROOT / ".runtime/policylens.db")
    redis_url: str = ""
    api_key: str = ""
    admin_key: str = ""
    demo_mode: bool = True
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    enable_reranker: bool = False
    provider: str = "extractive"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    rate_limit: int = 30
    cache_ttl: int = 300
    max_concurrency: int = 4
    min_cosine: float = 0.30
    request_timeout: float = 45


settings = Settings()
