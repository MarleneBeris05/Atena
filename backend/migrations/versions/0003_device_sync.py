"""Device pairing, immutable decks and offline study results."""

from alembic import op

revision = "0003_device_sync"
down_revision = "0002_flashcard_generation"


def upgrade():
    op.execute("""
        CREATE TABLE device_pairings (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            code_hash bytea NOT NULL UNIQUE,
            poll_hash bytea NOT NULL,
            credential_hash bytea NOT NULL,
            expires_at timestamptz NOT NULL,
            claimed_at timestamptz
        )
    """)
    op.execute("CREATE INDEX device_pairings_expiration ON device_pairings (expires_at)")
    op.execute("""
        CREATE TABLE device_pair_limits (
            bucket text PRIMARY KEY,
            window_started_at timestamptz NOT NULL,
            attempts integer NOT NULL CHECK (attempts > 0)
        )
    """)
    op.execute("""
        CREATE TABLE devices (
            id uuid PRIMARY KEY,
            owner_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
            name text NOT NULL,
            credential_hash bytea NOT NULL UNIQUE,
            linked_at timestamptz NOT NULL DEFAULT now(),
            revoked_at timestamptz,
            UNIQUE (id, owner_id)
        )
    """)
    op.execute("CREATE INDEX devices_owner ON devices (owner_id) WHERE revoked_at IS NULL")
    op.execute("""
        CREATE TABLE device_decks (
            device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE,
            version integer NOT NULL CHECK (version > 0),
            subject_id text NOT NULL,
            subject_name text NOT NULL,
            topic_id text NOT NULL,
            topic_name text NOT NULL,
            card_count integer NOT NULL CHECK (card_count > 0),
            sha256 text NOT NULL CHECK (length(sha256) = 64),
            package bytea NOT NULL,
            published_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (device_id, version)
        )
    """)
    op.execute("""
        CREATE TABLE device_deck_cards (
            device_id uuid NOT NULL,
            version integer NOT NULL,
            card_id text NOT NULL,
            question text NOT NULL,
            PRIMARY KEY (device_id, version, card_id),
            FOREIGN KEY (device_id, version) REFERENCES device_decks ON DELETE CASCADE
        )
    """)
    op.execute("""
        CREATE TABLE device_deck_receipts (
            device_id uuid NOT NULL,
            version integer NOT NULL,
            confirmed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (device_id, version),
            FOREIGN KEY (device_id, version) REFERENCES device_decks ON DELETE CASCADE
        )
    """)
    op.execute("""
        CREATE TABLE device_study_events (
            cursor bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
            owner_id uuid NOT NULL,
            event_id uuid NOT NULL,
            device_id uuid NOT NULL,
            deck_version integer NOT NULL,
            card_id text NOT NULL,
            rating text NOT NULL CHECK (rating IN ('remembered', 'review')),
            studied_at timestamptz NOT NULL,
            PRIMARY KEY (owner_id, event_id),
            FOREIGN KEY (device_id, owner_id) REFERENCES devices (id, owner_id) ON DELETE CASCADE,
            FOREIGN KEY (device_id, deck_version, card_id) REFERENCES device_deck_cards ON DELETE CASCADE,
            FOREIGN KEY (device_id, deck_version) REFERENCES device_deck_receipts ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX device_study_events_feed ON device_study_events (owner_id, cursor)")


def downgrade():
    for table in ("device_study_events", "device_deck_receipts", "device_deck_cards", "device_decks",
                  "devices", "device_pair_limits", "device_pairings"):
        op.drop_table(table)
