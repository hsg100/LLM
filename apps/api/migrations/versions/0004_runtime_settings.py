"""runtime settings store (single-row overrides)

Revision ID: 0004_runtime_settings
Revises: 0003_embedding_dim_384
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_runtime_settings"
down_revision = "0003_embedding_dim_384"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runtime_settings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("overrides", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.get_bind().execute(
        sa.text(
            "INSERT INTO runtime_settings (id, overrides, updated_at) "
            "VALUES ('singleton', '{}'::jsonb, now()) ON CONFLICT (id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_table("runtime_settings")
