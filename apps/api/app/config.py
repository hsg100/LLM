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

    # --- Authentication ---------------------------------------------------
    # HMAC secret used to sign session tokens. MUST be overridden in
    # production (set AUTH_SECRET). The default is clearly dev-only.
    auth_secret: str = "dev-insecure-auth-secret-change-me"
    auth_token_ttl_hours: int = 720  # 30 days
    # When False, the auth dependency falls back to the default user (used by
    # tests / fully-local single-user runs). Keep True for any shared deploy.
    require_auth: bool = True
    # Seed accounts created at API startup (idempotent). Override the passwords
    # in production via .env. The admin can delete landscapes.
    admin_email: str = "admin@fieldmap.local"
    admin_password: str = "FieldMap-Admin-2026"
    admin_name: str = "Admin"
    demo_user_email: str = "demo@fieldmap.local"
    demo_user_password: str = "FieldMap-Demo-2026"
    demo_user_name: str = "Demo User"

    semantic_scholar_api_key: str = ""
    openalex_email: str = ""

    llm_provider: str = "deepseek"
    # DeepSeek API tiers (override per account/needs in .env):
    #   strong → reasoning model for extraction/synthesis/relationships/concepts
    #   fast   → cheaper chat model for quiz/flashcards + short generations
    llm_model_fast: str = "deepseek-chat"
    llm_model_strong: str = "deepseek-reasoner"
    # Local (fastembed/ONNX) is the cost-free default; bge-small is 384-d.
    embedding_provider: str = "local"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    enable_embedding_dev_fallback: bool = True
    allow_embedding_fallback_in_production: bool = False

    obsidian_export_repo_path: str = "/data/obsidian"
    obsidian_export_git_remote: str = ""
    obsidian_export_auto_push: bool = False
    obsidian_auto_export: bool = False  # export on pipeline completion (opt-in)
    obsidian_export_author_name: str = "FieldMap Bot"
    obsidian_export_author_email: str = "fieldmap@local"

    # Directory holding the compiled curriculum artifacts (catalog.json +
    # catalog.grading.json). Empty = auto-discover: /curriculum/build (Docker)
    # then <repo-root>/curriculum/build (bare-metal dev/tests).
    curriculum_catalog_dir: str = ""

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
