from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, create_engine

from app.config import get_settings


logger = logging.getLogger("fieldmap.db")

settings = get_settings()

# apps/api — the directory that holds alembic.ini and migrations/.
_API_ROOT = Path(__file__).resolve().parents[1]

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


def _wait_for_db() -> None:
    """Block until Postgres answers ``SELECT 1`` or attempts are exhausted.

    Handles the common docker-compose race where the api/worker boots before
    Postgres is accepting connections, even with a healthcheck.
    """
    attempts = max(1, settings.db_connect_attempts)
    backoff = max(0.1, settings.db_connect_backoff_seconds)
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError as e:
            last_exc = e
            logger.warning(
                "db: postgres not ready (attempt %d/%d): %s",
                i + 1,
                attempts,
                _short(str(e)),
            )
            time.sleep(backoff)
    assert last_exc is not None
    raise last_exc


# Startup migration outcome, surfaced by GET /ready so a swallowed migration
# failure (or schema drift) fails the readiness probe instead of silently
# serving 500s. See init_db() and app.main.lifespan.
_migration_status: dict[str, str | None] = {"status": "unknown", "detail": None}


def set_migration_status(status: str, detail: str | None = None) -> None:
    _migration_status["status"] = status
    _migration_status["detail"] = detail


def get_migration_status() -> dict[str, str | None]:
    return dict(_migration_status)


def _alembic_config() -> "Config":  # type: ignore[name-defined] # noqa: F821
    from alembic.config import Config

    cfg = Config(str(_API_ROOT / "alembic.ini"))
    # Resolve paths absolutely so this works regardless of CWD (the app may be
    # launched from anywhere). env.py reads the DB URL from settings itself.
    cfg.set_main_option("script_location", str(_API_ROOT / "migrations"))
    return cfg


def alembic_current_and_head() -> tuple[str | None, str | None]:
    """Return (applied revision on the DB, latest revision in code).

    Equal means the schema is current; unequal means the live DB has drifted
    (e.g. never stamped, or a migration failed to apply). ``current`` is None
    when the DB has no ``alembic_version`` table at all.
    """
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    head = script.get_current_head()
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
    return current, head


def run_migrations() -> None:
    """Apply Alembic migrations up to head. Owned by the API process."""
    from alembic import command

    command.upgrade(_alembic_config(), "head")


def init_db() -> None:
    """API startup: wait for Postgres, validate config, migrate, then guard.

    Replaces the old ``create_all`` + ad-hoc ``ALTER TABLE`` patches. Schema is
    now owned entirely by Alembic (see migrations/). Only the API runs
    migrations; the worker calls :func:`wait_for_schema` to avoid two processes
    racing the first-time upgrade.
    """
    from app.services.embeddings import validate_embedding_configuration

    validate_embedding_configuration(settings)
    _wait_for_db()
    run_migrations()
    _validate_vector_columns()
    set_migration_status("ok")
    logger.info("init_db: connected, migrated, and schema ready")


def wait_for_schema(core_table: str = "landscapes") -> None:
    """Worker startup: wait for Postgres AND for the API's migrations to land.

    Polls for a core table rather than running migrations, so the worker never
    competes with the API to apply the first-time schema.
    """
    _wait_for_db()
    attempts = max(1, settings.db_connect_attempts)
    backoff = max(0.1, settings.db_connect_backoff_seconds)
    for i in range(attempts):
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT to_regclass(:name)"), {"name": f"public.{core_table}"}
            ).scalar()
        if exists is not None:
            logger.info("wait_for_schema: schema present")
            return
        logger.warning(
            "wait_for_schema: %s not present yet (attempt %d/%d)", core_table, i + 1, attempts
        )
        time.sleep(backoff)
    raise RuntimeError(
        f"wait_for_schema: table {core_table!r} never appeared; has the API run migrations?"
    )


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
    """Existing pgvector columns are fixed-width and are not resized by migration
    autogenerate; guard against a config/schema dimension mismatch."""
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
                "pgvector columns are fixed-width; add a migration to resize before "
                "changing dimensions."
            )
