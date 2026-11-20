from hashlib import sha256
from hmac import digest
from secrets import choice, token_urlsafe
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, StringConstraints

from .auth import Account
from .config import session_secret
from .db import Database


router = APIRouter(prefix="/devices", tags=["device pairing"])
device_bearer = HTTPBearer(auto_error=False, scheme_name="DeviceBearer")
DeviceToken = Annotated[HTTPAuthorizationCredentials | None, Depends(device_bearer)]
alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


class StartPairing(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] = "Atena"


class ClaimPairing(BaseModel):
    code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[2-9A-HJ-NP-Z]{8}$")]


def device_digest(purpose: str, value: str) -> bytes:
    return digest(session_secret(), (purpose + ":" + value).encode(), sha256)


def device_credential(pairing_id: UUID, poll_token: str) -> str:
    return "atd_" + device_digest("device-credential", f"{pairing_id}:{poll_token}").hex()


def reserve_attempt(db, bucket, maximum):
    result = db.execute("""
        INSERT INTO device_pair_limits (bucket, window_started_at, attempts) VALUES (%s, now(), 1)
        ON CONFLICT (bucket) DO UPDATE SET
            window_started_at = CASE WHEN device_pair_limits.window_started_at <= now() - interval '10 minutes'
                THEN now() ELSE device_pair_limits.window_started_at END,
            attempts = CASE WHEN device_pair_limits.window_started_at <= now() - interval '10 minutes'
                THEN 1 ELSE device_pair_limits.attempts + 1 END
        WHERE device_pair_limits.window_started_at <= now() - interval '10 minutes'
            OR device_pair_limits.attempts < %s
        RETURNING attempts
    """, (bucket, maximum)).fetchone()
    if result is None:
        raise HTTPException(429, "device_pair_limit", headers={"Retry-After": "600"})


@router.post("/pairings", status_code=201)
def start_pairing(payload: StartPairing, request: Request, db: Database):
    host = request.client.host if request.client else ""
    reserve_attempt(db, "start:" + device_digest("pairing-ip", host).hex(), 20)
    db.execute("DELETE FROM device_pairings WHERE expires_at <= now()")
    db.execute("""
        DELETE FROM device_pair_limits WHERE bucket IN (
            SELECT bucket FROM device_pair_limits WHERE window_started_at < now() - interval '1 day'
            LIMIT 100 FOR UPDATE SKIP LOCKED
        )
    """)
    pairing_id = uuid4()
    poll_token = "atp_" + token_urlsafe(32)
    credential = device_credential(pairing_id, poll_token)
    while True:
        code = "".join(choice(alphabet) for _ in range(8))
        row = db.execute("""
            INSERT INTO device_pairings (id, name, code_hash, poll_hash, credential_hash, expires_at)
            VALUES (%s, %s, %s, %s, %s, now() + interval '10 minutes')
            ON CONFLICT (code_hash) DO NOTHING RETURNING expires_at
        """, (pairing_id, payload.name, device_digest("pairing-code", code),
              device_digest("pairing-poll", poll_token), device_digest("device-auth", credential))).fetchone()
        if row:
            return {"pairingId": pairing_id, "code": code, "pollToken": poll_token,
                    "expiresAt": row["expires_at"], "pollIntervalSeconds": 5}


@router.post("/pairings/claim", status_code=201)
def claim_pairing(payload: ClaimPairing, db: Database, account: Account):
    owner = account["id"]
    reserve_attempt(db, f"claim:{owner}", 8)
    pairing = db.execute("""
        UPDATE device_pairings SET claimed_at = now()
        WHERE code_hash = %s AND claimed_at IS NULL AND expires_at > now()
        RETURNING id, name, credential_hash
    """, (device_digest("pairing-code", payload.code),)).fetchone()
    if pairing is None:
        # Commit rejected attempts so guessing a code consumes the quota.
        return JSONResponse({"detail": "device_code_unavailable"}, status_code=404)
    row = db.execute("""
        INSERT INTO devices (id, owner_id, name, credential_hash) VALUES (%s, %s, %s, %s)
        RETURNING id, name, linked_at
    """, (pairing["id"], owner, pairing["name"], pairing["credential_hash"])).fetchone()
    return {"id": row["id"], "name": row["name"], "linkedAt": row["linked_at"]}


def required_token(authorization, prefix):
    if authorization and authorization.credentials.startswith(prefix) and len(authorization.credentials) <= 128:
        return authorization.credentials
    raise HTTPException(401, "device_authentication_required", headers={"WWW-Authenticate": "Bearer"})


@router.post("/pairings/{pairing_id}/credential")
def collect_credential(pairing_id: UUID, authorization: DeviceToken, db: Database, response: Response):
    token = required_token(authorization, "atp_")
    row = db.execute("""
        SELECT p.claimed_at, d.revoked_at
        FROM device_pairings p LEFT JOIN devices d ON d.id = p.id
        WHERE p.id = %s AND p.poll_hash = %s AND p.expires_at > now()
    """, (pairing_id, device_digest("pairing-poll", token))).fetchone()
    if row is None or row["revoked_at"] is not None:
        raise HTTPException(404, "device_pairing_unavailable")
    if row["claimed_at"] is None:
        response.status_code = 202
        response.headers["Retry-After"] = "5"
        return {"status": "pending"}
    return {"status": "linked", "deviceId": pairing_id, "deviceToken": device_credential(pairing_id, token)}


def current_device(db: Database, authorization: DeviceToken):
    token = required_token(authorization, "atd_")
    device = db.execute("""
        SELECT id, owner_id FROM devices WHERE credential_hash = %s AND revoked_at IS NULL FOR SHARE
    """, (device_digest("device-auth", token),)).fetchone()
    if device is None:
        raise HTTPException(401, "device_authentication_required", headers={"WWW-Authenticate": "Bearer"})
    return device


Device = Annotated[dict, Depends(current_device)]


@router.delete("/{device_id}", status_code=204)
def revoke_device(device_id: UUID, db: Database, account: Account):
    result = db.execute("""
        UPDATE devices SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = %s AND owner_id = %s RETURNING id
    """, (device_id, account["id"])).fetchone()
    if result is None:
        raise HTTPException(404, "resource_not_found")
    db.execute("DELETE FROM device_pairings WHERE id = %s", (device_id,))
    return Response(status_code=204)
