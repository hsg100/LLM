"""resize pgvector embedding columns to 384 dims (local bge-small default)

pgvector columns are fixed-width, so switching the default embedding model from
OpenAI 1536-d to local bge-small 384-d requires altering the columns. We
drop + re-add the vector columns (embeddings are derived and recomputed on the
next pipeline run), which is safe under the recreate-from-scratch policy.

Revision ID: 0003_embedding_dim_384
Revises: 0002_seed_default_user
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op
from pgvector.sqlalchemy import Vector

revision = "0003_embedding_dim_384"
down_revision = "0002_seed_default_user"
branch_labels = None
depends_on = None

_TABLES = ("papers", "chunks")


def _swap_embedding_dim(dim: int) -> None:
    for table in _TABLES:
        op.drop_column(table, "embedding")
        op.add_column(table, sa_vector_column(dim), schema=None)


def sa_vector_column(dim: int):
    import sqlalchemy as sa

    return sa.Column("embedding", Vector(dim), nullable=True)


def upgrade() -> None:
    _swap_embedding_dim(384)


def downgrade() -> None:
    _swap_embedding_dim(1536)
