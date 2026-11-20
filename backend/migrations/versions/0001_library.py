"""Cuenta, sesiones y biblioteca de estudio."""

from alembic import op

revision = "0001_library"
down_revision = None


def upgrade():
    op.execute("""
        CREATE TABLE accounts (
            id uuid PRIMARY KEY,
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE auth_sessions (
            token_hash bytea PRIMARY KEY,
            account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            expires_at timestamptz NOT NULL
        )
    """)
    op.execute("CREATE INDEX auth_sessions_account ON auth_sessions (account_id)")
    op.execute("""
        CREATE TABLE subjects (
            owner_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            id text NOT NULL,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (owner_id, id)
        )
    """)
    op.execute("""
        CREATE TABLE topics (
            owner_id uuid NOT NULL,
            id text NOT NULL,
            subject_id text NOT NULL,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (owner_id, id),
            FOREIGN KEY (owner_id, subject_id) REFERENCES subjects ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX topics_subject ON topics (owner_id, subject_id)")
    op.execute("""
        CREATE TABLE reviews (
            owner_id uuid NOT NULL,
            id text NOT NULL,
            topic_id text NOT NULL,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (owner_id, id),
            FOREIGN KEY (owner_id, topic_id) REFERENCES topics ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX reviews_topic ON reviews (owner_id, topic_id)")
    op.execute("""
        CREATE TABLE imported_ids (
            owner_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            kind text NOT NULL CHECK (kind IN ('subjects', 'topics', 'reviews')),
            resource_id text NOT NULL,
            PRIMARY KEY (owner_id, kind, resource_id)
        )
    """)


def downgrade():
    for table in ("imported_ids", "reviews", "topics", "subjects", "auth_sessions", "accounts"):
        op.drop_table(table)
