from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://fieldmap:fieldmap@db:5432/fieldmap"
    redis_url: str = "redis://redis:6379/0"
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    cors_allowed_origin_regex: str = ""

    openai_api_key: str = ""
    deepseek_api_key: str = ""
    anthropic_api_key: str = ""

    semantic_scholar_api_key: str = ""
    openalex_email: str = ""

    llm_provider: str = "deepseek"
    # DeepSeek API tiers (override per account/needs in .env):
    #   strong → reasoning model for extraction/synthesis/relationships/concepts
    #   fast   → cheaper chat model for quiz/flashcards + short generations
    llm_model_fast: str = "deepseek-chat"
    llm_model_strong: str = "deepseek-reasoner"
    embedding_provider: str = "stub"
    embedding_model: str = "stub"
    embedding_dim: int = 1536
    enable_embedding_dev_fallback: bool = True
    allow_embedding_fallback_in_production: bool = False

    obsidian_export_repo_path: str = "/data/obsidian"
    obsidian_export_git_remote: str = ""
    obsidian_export_auto_push: bool = False
    obsidian_export_author_name: str = "FieldMap Bot"
    obsidian_export_author_email: str = "fieldmap@local"

    max_papers_per_landscape: int = 50
    max_pdf_mb: int = 50
    pdf_storage_dir: str = "/data/pdfs"
    max_candidates: int = 80
    max_paper_text_chars: int = 9000
    synthesis_timeout_seconds: int = 75
    concept_timeout_seconds: int = 75
    active_recall_timeout_seconds: int = 75

    # Runtime + robustness knobs
    env: str = "development"  # development | production
    log_level: str = "INFO"
    enable_dev_fallback: bool = True  # use deterministic stub when all paper sources fail
    arxiv_timeout_seconds: int = 30
    http_user_agent: str = "FieldMap/0.1 (research tool; +https://example.invalid/fieldmap)"
    db_connect_attempts: int = 30
    db_connect_backoff_seconds: float = 1.0
    redis_connect_attempts: int = 30
    redis_connect_backoff_seconds: float = 1.0

    @property
    def is_development(self) -> bool:
        return (self.env or "").lower() in ("development", "dev", "local", "test")


@lru_cache
def get_settings() -> Settings:
    return Settings()
