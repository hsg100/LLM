"""Alembic environment.

Reads the database URL from the application settings (DATABASE_URL) rather than
alembic.ini, so the CLI and the running app always target the same database.
``target_metadata`` is SQLModel's metadata, so ``alembic revision --autogenerate``
works once a database is reachable.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Import models so every table is registered on SQLModel.metadata, and import
# pgvector so the Vector column type is known to autogenerate.
import pgvector.sqlalchemy  # noqa: F401
from sqlmodel import SQLModel

from app import models  # noqa: F401  (registers tables)
from app.config import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override whatever is (not) in the ini with the app's configured URL.
config.set_main_option("sqlalchemy.url", get_settings().database_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
