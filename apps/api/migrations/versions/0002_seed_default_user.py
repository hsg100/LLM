"""seed default single-user

Inserts the well-known default user that owns all landscapes while the app runs
single-user. See app.users.DEFAULT_USER_ID.

Revision ID: 0002_seed_default_user
Revises: 0001_initial
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.users import DEFAULT_USER_EMAIL, DEFAULT_USER_ID, DEFAULT_USER_NAME

revision = "0002_seed_default_user"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "INSERT INTO users (id, email, name, created_at) "
            "VALUES (:id, :email, :name, now()) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": DEFAULT_USER_ID, "email": DEFAULT_USER_EMAIL, "name": DEFAULT_USER_NAME},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM users WHERE id = :id"), {"id": DEFAULT_USER_ID}
    )
