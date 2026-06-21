"""initial baseline schema

Squash/baseline migration. Per the recovery decision to recreate the alpha DB
from scratch, this creates the pgvector extension and the full schema from the
current SQLModel metadata. Subsequent schema changes MUST be explicit Alembic
revisions (op.add_column / op.alter_column / ...), not edits to the models that
silently change this baseline.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# pgvector must be imported so Vector columns resolve when metadata is created.
import pgvector.sqlalchemy  # noqa: F401
from sqlmodel import SQLModel

import app.models  # noqa: F401  (registers all tables on SQLModel.metadata)

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # pgvector extension must exist before the Vector columns are created.
    bind.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
    SQLModel.metadata.create_all(bind)


def downgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.drop_all(bind)
