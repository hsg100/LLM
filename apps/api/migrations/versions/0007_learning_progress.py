"""learning progress (curriculum/lesson progress + checkpoint attempts)

Revision ID: 0007_learning_progress
Revises: 0006_user_auth_columns
Create Date: 2026-07-13

Additive only (docs/PHASE_2_TECHNICAL_DESIGN.md §8): three new tables, no
existing table touched. Downgrade drops them — learner progress only, never
research data.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql

revision = '0007_learning_progress'
down_revision = '0006_user_auth_columns'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'curriculum_progress',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('user_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('curriculum_slug', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('curriculum_version', sa.Integer(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('current_topic_slug', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'curriculum_slug', 'curriculum_version',
                            name='uq_curriculum_progress'),
        sa.CheckConstraint("status IN ('active','completed')",
                           name='ck_curriculum_progress_status'),
        sa.CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL)"
            " OR (status <> 'completed' AND completed_at IS NULL)",
            name='ck_curriculum_progress_completion'),
    )
    op.create_index(op.f('ix_curriculum_progress_user_id'), 'curriculum_progress',
                    ['user_id'], unique=False)

    op.create_table(
        'lesson_progress',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('user_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('lesson_slug', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('lesson_version', sa.Integer(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('last_block_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('best_checkpoint_score', sa.Float(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'lesson_slug', 'lesson_version',
                            name='uq_lesson_progress'),
        sa.CheckConstraint("status IN ('in_progress','completed')",
                           name='ck_lesson_progress_status'),
        sa.CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL)"
            " OR (status <> 'completed' AND completed_at IS NULL)",
            name='ck_lesson_progress_completion'),
        sa.CheckConstraint(
            'best_checkpoint_score IS NULL'
            ' OR (best_checkpoint_score >= 0 AND best_checkpoint_score <= 1)',
            name='ck_lesson_progress_score'),
    )
    op.create_index(op.f('ix_lesson_progress_user_id'), 'lesson_progress',
                    ['user_id'], unique=False)
    op.create_index('ix_lesson_progress_user_status', 'lesson_progress',
                    ['user_id', 'status', 'updated_at'], unique=False)

    op.create_table(
        'checkpoint_attempts',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('user_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('lesson_slug', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('lesson_version', sa.Integer(), nullable=False),
        sa.Column('checkpoint_slug', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('passed', sa.Boolean(), nullable=False),
        sa.Column('responses', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('client_attempt_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'client_attempt_id',
                            name='uq_checkpoint_attempt_client'),
    )
    op.create_index(op.f('ix_checkpoint_attempts_user_id'), 'checkpoint_attempts',
                    ['user_id'], unique=False)
    op.create_index('ix_checkpoint_attempts_user_lesson', 'checkpoint_attempts',
                    ['user_id', 'lesson_slug', 'lesson_version', 'created_at'], unique=False)


def downgrade() -> None:
    # Drops learner progress only (documented, accepted for Phase 2);
    # research data is untouched in both directions.
    op.drop_index('ix_checkpoint_attempts_user_lesson', table_name='checkpoint_attempts')
    op.drop_index(op.f('ix_checkpoint_attempts_user_id'), table_name='checkpoint_attempts')
    op.drop_table('checkpoint_attempts')
    op.drop_index('ix_lesson_progress_user_status', table_name='lesson_progress')
    op.drop_index(op.f('ix_lesson_progress_user_id'), table_name='lesson_progress')
    op.drop_table('lesson_progress')
    op.drop_index(op.f('ix_curriculum_progress_user_id'), table_name='curriculum_progress')
    op.drop_table('curriculum_progress')
