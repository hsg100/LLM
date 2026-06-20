from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings


logger = logging.getLogger("fieldmap.db")

settings = get_settings()

engine = create_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    # Disable psycopg3 server-side prepared statements. We saw
    # "DuplicatePreparedStatement: prepared statement '_pg3_1' already exists"
    # when the same pooled connection was reused across jobs/sessions. The
    # SQLAlchemy text cache makes this overhead minimal in practice.
    connect_args={"prepare_threshold": None},
)


def init_db() -> None:
    """Wait for Postgres, enable pgvector, then create tables.

    Both the api and the worker call this on startup. We retry on
    ``OperationalError`` to handle the common docker-compose race where
    the api/worker boots faster than postgres is ready, even with a
    healthcheck.
    """
    attempts = max(1, settings.db_connect_attempts)
    backoff = max(0.1, settings.db_connect_backoff_seconds)
    last_exc: Exception | None = None

    for i in range(attempts):
        try:
            from app.services.embeddings import validate_embedding_configuration

            validate_embedding_configuration(settings)
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            # Import models so SQLModel registers them.
            from app import models  # noqa: F401

            SQLModel.metadata.create_all(engine)
            _ensure_chunk_metadata_columns()
            _ensure_concept_columns()
            _validate_vector_columns()
            logger.info("init_db: connected and schema ready")
            return
        except OperationalError as e:
            last_exc = e
            logger.warning(
                "init_db: postgres not ready (attempt %d/%d): %s",
                i + 1,
                attempts,
                _short(str(e)),
            )
            time.sleep(backoff)
        except Exception as e:
            last_exc = e
            logger.exception("init_db: unexpected failure (attempt %d/%d)", i + 1, attempts)
            time.sleep(backoff)
    assert last_exc is not None
    raise last_exc


@contextmanager
def session_scope() -> Iterator[Session]:
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    with session_scope() as s:
        yield s


def _short(msg: str, n: int = 200) -> str:
    msg = (msg or "").strip().replace("\n", " ")
    return msg if len(msg) <= n else msg[: n - 1] + "…"


def _validate_vector_columns() -> None:
    """Existing pgvector columns are fixed-width and are not resized by create_all."""
    expected = f"vector({settings.embedding_dim})"
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname AS table_name,
                       a.attname AS column_name,
                       format_type(a.atttypid, a.atttypmod) AS formatted_type
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname IN ('papers', 'chunks')
                  AND a.attname = 'embedding'
                  AND NOT a.attisdropped
                ORDER BY c.relname, a.attname
                """
            )
        ).mappings().all()
    for row in rows:
        actual = str(row["formatted_type"])
        if actual != expected:
            raise RuntimeError(
                f"{row['table_name']}.{row['column_name']} is {actual}, "
                f"but EMBEDDING_DIM={settings.embedding_dim} expects {expected}. "
                "pgvector columns are fixed-width; migrate or recreate these columns before changing dimensions."
            )


def _ensure_chunk_metadata_columns() -> None:
    """create_all does not add columns to existing local alpha DBs."""
    statements = [
        "ALTER TABLE IF EXISTS paper_sections ADD COLUMN IF NOT EXISTS page_start INTEGER",
        "ALTER TABLE IF EXISTS paper_sections ADD COLUMN IF NOT EXISTS page_end INTEGER",
        "ALTER TABLE IF EXISTS chunks ADD COLUMN IF NOT EXISTS section_heading TEXT",
        "ALTER TABLE IF EXISTS chunks ADD COLUMN IF NOT EXISTS page_start INTEGER",
        "ALTER TABLE IF EXISTS chunks ADD COLUMN IF NOT EXISTS page_end INTEGER",
        "ALTER TABLE IF EXISTS chunks ADD COLUMN IF NOT EXISTS char_start INTEGER",
        "ALTER TABLE IF EXISTS chunks ADD COLUMN IF NOT EXISTS char_end INTEGER",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def _ensure_concept_columns() -> None:
    """Backfill richer concept columns for alpha DBs created with the old table."""
    statements = [
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS term TEXT",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS slug VARCHAR",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS aliases JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS short_definition TEXT",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS long_definition TEXT",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS why_it_matters TEXT",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS related_terms JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS paper_ids JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS source_grounding JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 0.5",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS importance FLOAT DEFAULT 0.5",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
        "ALTER TABLE IF EXISTS concepts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        "UPDATE concepts SET term = COALESCE(term, name)",
        "UPDATE concepts SET slug = COALESCE(slug, regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))",
        "UPDATE concepts SET short_definition = COALESCE(short_definition, definition)",
        "UPDATE concepts SET long_definition = COALESCE(long_definition, definition)",
        "UPDATE concepts SET created_at = COALESCE(created_at, NOW())",
        "UPDATE concepts SET updated_at = COALESCE(updated_at, NOW())",
        "CREATE INDEX IF NOT EXISTS ix_concepts_slug ON concepts (slug)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
