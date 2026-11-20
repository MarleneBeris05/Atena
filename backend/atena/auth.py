from datetime import timedelta
from hashlib import sha256
from hmac import digest
from secrets import token_urlsafe
from typing import Annotated
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import session_secret
from .db import Database
from .models import Credentials, Register


router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)
BearerToken = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
hasher = PasswordHasher(time_cost=3, memory_cost=19456, parallelism=1)
dummy_hash = hasher.hash(token_urlsafe(32))


def session_hash(token: str) -> bytes:
    return digest(session_secret(), token.encode(), sha256)


def current_account(db: Database, authorization: BearerToken):
    if authorization and len(authorization.credentials) <= 128:
        account = db.execute("""
            SELECT a.id, a.email FROM auth_sessions s
            JOIN accounts a ON a.id = s.account_id
            WHERE s.token_hash = %s AND s.expires_at > now()
        """, (session_hash(authorization.credentials),)).fetchone()
        if account:
            return account
    raise HTTPException(401, "authentication_required", headers={"WWW-Authenticate": "Bearer"})


Account = Annotated[dict, Depends(current_account)]


def issue_session(db, account):
    db.execute("DELETE FROM auth_sessions WHERE account_id = %s AND expires_at <= now()", (account["id"],))
    token = token_urlsafe(32)
    db.execute("""
        INSERT INTO auth_sessions (token_hash, account_id, expires_at)
        VALUES (%s, %s, now() + %s)
    """, (session_hash(token), account["id"], timedelta(days=7)))
    return {"token": token, "account": {"id": account["id"], "email": account["email"]}}


@router.post("/register", status_code=201)
def register(payload: Register, db: Database):
    password_hash = hasher.hash(payload.password.get_secret_value())
    account = db.execute("""
        INSERT INTO accounts (id, email, password_hash) VALUES (%s, %s, %s)
        ON CONFLICT (email) DO NOTHING RETURNING id, email
    """, (uuid4(), payload.email, password_hash)).fetchone()
    if not account:
        raise HTTPException(409, "registration_conflict")
    return issue_session(db, account)


@router.post("/login")
def login(payload: Credentials, db: Database):
    account = db.execute("SELECT * FROM accounts WHERE email = %s", (payload.email,)).fetchone()
    try:
        hasher.verify(account["password_hash"] if account else dummy_hash, payload.password.get_secret_value())
    except VerifyMismatchError:
        raise HTTPException(401, "invalid_credentials") from None
    if not account:
        raise HTTPException(401, "invalid_credentials")
    return issue_session(db, account)


@router.post("/logout", status_code=204)
def logout(db: Database, authorization: BearerToken):
    if authorization and len(authorization.credentials) <= 128:
        db.execute("DELETE FROM auth_sessions WHERE token_hash = %s", (session_hash(authorization.credentials),))
    return Response(status_code=204)
