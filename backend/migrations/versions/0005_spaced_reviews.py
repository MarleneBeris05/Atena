"""Plans, offline review sessions and device delivery revisions."""

from alembic import op

revision = "0005_spaced_reviews"
down_revision = "0004_pomodoros"


def upgrade():
    op.execute("""
        CREATE TABLE spaced_plans (
            id uuid PRIMARY KEY,
            owner_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            topic_id text NOT NULL,
            subject_name text NOT NULL,
            topic_name text NOT NULL,
            device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
            start_date date NOT NULL,
            exam_date date NOT NULL CHECK (exam_date > start_date),
            reason text NOT NULL,
            timezone text NOT NULL,
            review_time time NOT NULL,
            minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 180),
            cancelled boolean NOT NULL DEFAULT false
        )
    """)
    op.execute("CREATE INDEX spaced_plans_owner ON spaced_plans (owner_id, topic_id)")
    op.execute("""
        CREATE TABLE spaced_sessions (
            id uuid PRIMARY KEY,
            plan_id uuid NOT NULL REFERENCES spaced_plans ON DELETE CASCADE,
            device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
            local_date date NOT NULL,
            local_time time NOT NULL,
            starts_at timestamptz NOT NULL,
            minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 180),
            reason text NOT NULL,
            cancelled_at timestamptz,
            result text CHECK (result IN ('completed', 'skipped')),
            finished_at timestamptz
        )
    """)
    op.execute("CREATE INDEX spaced_sessions_plan ON spaced_sessions (plan_id, starts_at)")
    op.execute("CREATE INDEX spaced_sessions_device ON spaced_sessions (device_id, starts_at) WHERE result IS NULL AND cancelled_at IS NULL")
    op.execute("""
        CREATE TABLE spaced_agendas (
            device_id uuid PRIMARY KEY REFERENCES devices ON DELETE CASCADE,
            revision integer NOT NULL DEFAULT 0,
            confirmed integer NOT NULL DEFAULT 0
        )
    """)
    op.execute("""
        CREATE TABLE spaced_deliveries (
            plan_id uuid REFERENCES spaced_plans ON DELETE CASCADE,
            device_id uuid REFERENCES spaced_agendas ON DELETE CASCADE,
            revision integer NOT NULL,
            PRIMARY KEY (plan_id, device_id)
        )
    """)


def downgrade():
    for table in ("spaced_deliveries", "spaced_agendas", "spaced_sessions", "spaced_plans"):
        op.drop_table(table)
