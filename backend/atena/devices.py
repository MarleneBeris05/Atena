import json
from hashlib import sha256
from hmac import compare_digest
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints

from .auth import Account
from .db import Database
from .device_pairing import Device
from .models import ResourceId


router = APIRouter(prefix="/devices", tags=["device sync"])
MAX_DECK_BYTES = 1024 * 1024
MAX_DECK_CARDS = 500
ACTIVITY_PAGE_SIZE = 200
Version = Annotated[int, Field(ge=1, le=2_147_483_647)]
Checksum = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class PublishDeck(BaseModel):
    topicId: ResourceId


class ConfirmDeck(BaseModel):
    sha256: Checksum


class StudyEvent(BaseModel):
    id: UUID
    cardId: ResourceId
    deckVersion: Version
    rating: Literal["remembered", "review"]
    studiedAt: AwareDatetime


class StudyBatch(BaseModel):
    events: Annotated[list[StudyEvent], Field(min_length=1, max_length=100)]


manifest_columns = """
    version, subject_id, subject_name, topic_id, topic_name, card_count, sha256, published_at,
    octet_length(package) AS size_bytes
"""


def deck_manifest(row):
    if row is None:
        return None
    return {
        "version": row["version"], "cardCount": row["card_count"], "sizeBytes": row["size_bytes"],
        "sha256": row["sha256"], "publishedAt": row["published_at"],
        "subject": {"id": row["subject_id"], "name": row["subject_name"]},
        "topic": {"id": row["topic_id"], "name": row["topic_name"]},
    }


def deck_state(db, owner, device_id=None):
    rows = db.execute(f"""
        SELECT d.id, d.name, d.linked_at, row_to_json(latest) AS published, row_to_json(ack) AS confirmed
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT {manifest_columns} FROM device_decks WHERE device_id = d.id ORDER BY version DESC LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
            SELECT r.version, r.confirmed_at, p.topic_id, p.topic_name
            FROM device_deck_receipts r JOIN device_decks p USING (device_id, version)
            WHERE r.device_id = d.id ORDER BY r.version DESC LIMIT 1
        ) ack ON true
        WHERE d.owner_id = %s AND d.revoked_at IS NULL AND (%s::uuid IS NULL OR d.id = %s)
        ORDER BY d.linked_at, d.id
    """, (owner, device_id, device_id)).fetchall()
    result = []
    for row in rows:
        receipt = row["confirmed"]
        result.append({
            "id": row["id"], "name": row["name"], "linkedAt": row["linked_at"],
            "published": deck_manifest(row["published"]),
            "confirmed": {
                "version": receipt["version"], "confirmedAt": receipt["confirmed_at"],
                "topic": {"id": receipt["topic_id"], "name": receipt["topic_name"]},
            } if receipt else None,
        })
    return result


@router.get("")
def list_devices(db: Database, account: Account):
    return {"devices": deck_state(db, account["id"])}


@router.post("/{device_id}/decks", status_code=201)
def publish_deck(device_id: UUID, payload: PublishDeck, db: Database, account: Account):
    owner = account["id"]
    device = db.execute("""
        SELECT id FROM devices WHERE id = %s AND owner_id = %s AND revoked_at IS NULL FOR UPDATE
    """, (device_id, owner)).fetchone()
    if not device:
        raise HTTPException(404, "resource_not_found")

    rows = db.execute("""
        SELECT t.id AS topic_id, t.data->>'name' AS topic_name, s.id AS subject_id,
               s.data->>'name' AS subject_name, r.id AS card_id,
               r.data->>'question' AS question, r.data->>'answer' AS answer
        FROM topics t JOIN subjects s ON s.id = t.subject_id AND s.owner_id = t.owner_id
        LEFT JOIN reviews r ON r.owner_id = t.owner_id AND r.topic_id = t.id AND r.data->>'type' = 'flashcard'
        WHERE t.owner_id = %s AND t.id = %s
        ORDER BY r.created_at, r.id LIMIT %s
    """, (owner, payload.topicId, MAX_DECK_CARDS + 1)).fetchall()
    if not rows:
        raise HTTPException(404, "resource_not_found")
    first = rows[0]
    if first["card_id"] is None:
        raise HTTPException(422, "device_empty_deck")
    if len(rows) > MAX_DECK_CARDS:
        raise HTTPException(422, "device_deck_too_large")
    version = db.execute("""
        SELECT COALESCE(max(version), 0) + 1 AS next_version FROM device_decks WHERE device_id = %s
    """, (device_id,)).fetchone()["next_version"]
    subject = {"id": first["subject_id"], "name": first["subject_name"]}
    topic = {"id": first["topic_id"], "name": first["topic_name"]}
    cards = [{"id": row["card_id"], "question": row["question"], "answer": row["answer"]} for row in rows]
    data = {"schemaVersion": 1, "version": version, "subject": subject, "topic": topic, "cards": cards}
    package = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(package) > MAX_DECK_BYTES:
        raise HTTPException(422, "device_deck_too_large")

    published = db.execute(f"""
        INSERT INTO device_decks
            (device_id, version, subject_id, subject_name, topic_id, topic_name, card_count, sha256, package)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING {manifest_columns}
    """, (device_id, version, subject["id"], subject["name"], topic["id"], topic["name"],
          len(cards), sha256(package).hexdigest(), package)).fetchone()
    with db.cursor() as cursor:
        cursor.executemany("""
            INSERT INTO device_deck_cards (device_id, version, card_id, question) VALUES (%s, %s, %s, %s)
        """, [(device_id, version, card["id"], card["question"]) for card in cards])
    return deck_manifest(published)


@router.get("/sync/manifest")
def sync_manifest(db: Database, device: Device):
    state = deck_state(db, device["owner_id"], device["id"])[0]
    return {"available": state["published"], "confirmed": state["confirmed"]}


@router.get("/sync/decks/{version}")
def download_deck(version: Version, db: Database, device: Device):
    row = db.execute("""
        SELECT package, sha256 FROM device_decks WHERE device_id = %s AND version = %s
    """, (device["id"], version)).fetchone()
    if row is None:
        raise HTTPException(404, "resource_not_found")
    return Response(row["package"], media_type="application/json; charset=utf-8", headers={
        "ETag": '"' + row["sha256"] + '"', "Cache-Control": "no-store, no-transform",
    })


@router.post("/sync/decks/{version}/confirm")
def confirm_deck(version: Version, payload: ConfirmDeck, db: Database, device: Device):
    device_id = device["id"]
    deck = db.execute("""
        SELECT sha256 FROM device_decks WHERE device_id = %s AND version = %s
    """, (device_id, version)).fetchone()
    if deck is None:
        raise HTTPException(404, "resource_not_found")
    if not compare_digest(deck["sha256"], payload.sha256):
        raise HTTPException(409, "device_checksum_mismatch")
    receipt = db.execute("""
        INSERT INTO device_deck_receipts (device_id, version) VALUES (%s, %s)
        ON CONFLICT DO NOTHING RETURNING confirmed_at
    """, (device_id, version)).fetchone()
    if receipt is None:
        receipt = db.execute("""
            SELECT confirmed_at FROM device_deck_receipts WHERE device_id = %s AND version = %s
        """, (device_id, version)).fetchone()
    return {"version": version, "confirmedAt": receipt["confirmed_at"]}


@router.post("/sync/events")
def save_events(payload: StudyBatch, db: Database, device: Device):
    owner, device_id = device["owner_id"], device["id"]
    # Preserve commit order for this account's cursor across concurrent device uploads.
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 194337))", (str(owner),))
    accepted = duplicates = 0
    for event in payload.events:
        existing = db.execute("""
            SELECT device_id, deck_version, card_id, rating, studied_at
            FROM device_study_events WHERE owner_id = %s AND event_id = %s
        """, (owner, event.id)).fetchone()
        values = (device_id, event.deckVersion, event.cardId, event.rating, event.studiedAt)
        if existing:
            previous = tuple(existing[field] for field in ("device_id", "deck_version", "card_id", "rating", "studied_at"))
            if previous != values:
                raise HTTPException(409, "device_event_conflict")
            duplicates += 1
            continue
        allowed = db.execute("""
            SELECT 1 FROM device_deck_cards JOIN device_deck_receipts USING (device_id, version)
            WHERE device_id = %s AND version = %s AND card_id = %s
        """, values[:3]).fetchone()
        if not allowed:
            raise HTTPException(422, "device_event_card_unavailable")
        db.execute("""
            INSERT INTO device_study_events (owner_id, event_id, device_id, deck_version, card_id, rating, studied_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (owner, event.id, *values))
        accepted += 1
    return {"accepted": accepted, "duplicates": duplicates}


@router.get("/activity")
def list_device_activity(db: Database, account: Account,
                         after: Annotated[int, Query(ge=0, le=9_223_372_036_854_775_807)] = 0):
    rows = db.execute("""
        SELECT e.cursor, e.event_id AS id, e.device_id AS "deviceId", d.name AS "deviceName",
            e.deck_version AS "deckVersion", e.card_id AS "cardId", e.rating, e.studied_at AS "studiedAt",
            p.topic_id AS "topicId", p.topic_name AS "topicName", c.question
        FROM device_study_events e
        JOIN devices d ON d.id = e.device_id
        JOIN device_decks p ON p.device_id = e.device_id AND p.version = e.deck_version
        JOIN device_deck_cards c ON c.device_id = e.device_id AND c.version = e.deck_version AND c.card_id = e.card_id
        WHERE e.owner_id = %s AND e.cursor > %s ORDER BY e.cursor LIMIT %s
    """, (account["id"], after, ACTIVITY_PAGE_SIZE + 1)).fetchall()
    page = rows[:ACTIVITY_PAGE_SIZE]
    next_cursor = page[-1]["cursor"] if page else after
    for row in page:
        del row["cursor"]
    return {"events": page, "nextCursor": str(next_cursor), "hasMore": len(rows) > ACTIVITY_PAGE_SIZE}
