from functools import lru_cache
from os import environ
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row


@lru_cache
def database_url() -> str:
    return environ["DATABASE_URL"]


@lru_cache
def session_secret() -> bytes:
    secret = environ["SESSION_SECRET"].encode()
    if len(secret) < 32:
        raise ValueError("SESSION_SECRET must be at least 32 bytes")
    return secret


def allowed_origins() -> list[str]:
    origins = [value.strip().rstrip("/") for value in environ.get("ALLOWED_ORIGINS", "").split(",") if value.strip()]
    for origin in origins:
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or not parsed.netloc
                or parsed.path or parsed.query or parsed.fragment or parsed.username or "*" in origin):
            raise ValueError("ALLOWED_ORIGINS must contain exact HTTP(S) origins")
    return origins


def connection():
    return psycopg.connect(database_url(), row_factory=dict_row, connect_timeout=3)
