"""Track draft generation limits per account."""

from alembic import op

revision = "0002_flashcard_generation"
down_revision = "0001_library"


def upgrade():
    op.execute("""
        CREATE TABLE flashcard_generation_limits (
            account_id uuid PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,
            window_started_at timestamptz NOT NULL,
            attempts integer NOT NULL CHECK (attempts > 0)
        )
    """)


def downgrade():
    op.drop_table("flashcard_generation_limits")
