"""Account Pomodoro configurations."""

from alembic import op

revision = "0004_pomodoros"
down_revision = "0003_device_sync"


def upgrade():
    op.execute("""
        CREATE TABLE pomodoros (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            owner_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            work_minutes integer NOT NULL CHECK (work_minutes > 0),
            break_minutes integer NOT NULL CHECK (break_minutes > 0)
        )
    """)
    op.execute("CREATE INDEX pomodoros_owner_id ON pomodoros (owner_id, id)")


def downgrade():
    op.drop_table("pomodoros")
