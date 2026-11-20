from os import getenv
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator

from .auth import Account, BearerToken, current_account
from .config import connection
from .db import Database
from .gemini import request_drafts
from .library import create_entry, lock_account, parent_exists
from .models import Flashcard, RequiredText, ResourceId


router = APIRouter(prefix="/library/topics", tags=["flashcards"])
MAX_NOTES = 12_000
MAX_CARDS = 10
REQUESTS_PER_WINDOW = 5


class GenerateFlashcards(BaseModel):
    notes: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NOTES)]
    count: Annotated[int, Field(strict=True, ge=1, le=MAX_CARDS)] = 5


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
    source: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=800)]


class Drafts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    drafts: Annotated[list[Draft], Field(max_length=MAX_CARDS)]


class ApprovedCard(BaseModel):
    id: ResourceId
    question: RequiredText
    answer: RequiredText


class SaveFlashcards(BaseModel):
    cards: Annotated[list[ApprovedCard], Field(min_length=1, max_length=MAX_CARDS)]

    @field_validator("cards")
    @classmethod
    def check_ids(cls, cards):
        if len({card.id for card in cards}) != len(cards):
            raise ValueError("Duplicate flashcard IDs")
        return cards


def require_topic(db, owner, topic_id):
    if not parent_exists(db, owner, "reviews", {"topicId": topic_id}):
        raise HTTPException(404, "resource_not_found")


def reserve_generation(db, owner):
    reserved = db.execute("""
        INSERT INTO flashcard_generation_limits (account_id, window_started_at, attempts)
        VALUES (%s, now(), 1)
        ON CONFLICT (account_id) DO UPDATE SET
          window_started_at = CASE
              WHEN flashcard_generation_limits.window_started_at <= now() - interval '10 minutes' THEN now()
              ELSE flashcard_generation_limits.window_started_at END,
          attempts = CASE
              WHEN flashcard_generation_limits.window_started_at <= now() - interval '10 minutes' THEN 1
              ELSE flashcard_generation_limits.attempts + 1 END
        WHERE flashcard_generation_limits.window_started_at <= now() - interval '10 minutes'
           OR flashcard_generation_limits.attempts < %s
        RETURNING attempts
    """, (owner, REQUESTS_PER_WINDOW)).fetchone()
    if not reserved:
        raise HTTPException(429, "generation_limit", headers={"Retry-After": "600"})


@router.post("/{topic_id}/flashcard-drafts", response_model=Drafts)
def generate_flashcards(topic_id: ResourceId, payload: GenerateFlashcards, token: BearerToken):
    with connection() as db:
        owner = current_account(db, token)["id"]
        require_topic(db, owner, topic_id)
        key, model = (getenv(name, "").strip() for name in ("GEMINI_API_KEY", "GEMINI_MODEL"))
        if not key or not model:
            raise HTTPException(503, "generation_not_configured")
        reserve_generation(db, owner)

    raw = request_drafts(payload.notes, payload.count, key, model)
    try:
        result = Drafts.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(502, "generation_invalid") from None
    if len(result.drafts) > payload.count or any(draft.source not in payload.notes for draft in result.drafts):
        raise HTTPException(502, "generation_invalid")
    return result


@router.post("/{topic_id}/flashcards", response_model=list[Flashcard], status_code=201)
def save_flashcards(topic_id: ResourceId, payload: SaveFlashcards, db: Database, account: Account):
    owner = account["id"]
    lock_account(db, owner)
    require_topic(db, owner, topic_id)
    cards = [Flashcard(**card.model_dump(), topicId=topic_id, type="flashcard") for card in payload.cards]
    return [create_entry(db, owner, "reviews", card.model_dump()) for card in cards]
