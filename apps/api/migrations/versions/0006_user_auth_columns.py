"""add auth columns to users (password_hash, is_admin)

Login accounts are seeded at API startup (see app.users.ensure_seed_users),
so this migration only adds the columns. Passwords are never stored in the
migration / git — they come from settings/.env at runtime.

Revision ID: 0006_user_auth_columns
Revises: 0005_review_states
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_user_auth_columns"
down_revision = "0005_review_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
    op.drop_column("users", "password_hash")
