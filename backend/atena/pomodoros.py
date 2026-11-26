from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field

from .auth import Account
from .db import Database
from .device_pairing import Device


router = APIRouter(tags=["pomodoros"])
MAX_POMODOROS = 64
Minutes = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
PomodoroId = Annotated[int, Path(gt=0, le=9_223_372_036_854_775_807)]
durations = 'work_minutes AS "workMinutes", break_minutes AS "breakMinutes"'
configuration = f"id::text AS id, {durations}"


@router.get("/pomodoros")
def list_pomodoros(db: Database, account: Account):
    rows = db.execute(f"""
        SELECT {configuration} FROM pomodoros WHERE owner_id = %s ORDER BY id
    """, (account["id"],)).fetchall()
    return {"pomodoros": rows}


class Pomodoro(BaseModel):
    workMinutes: Minutes
    breakMinutes: Minutes


@router.post("/pomodoros", status_code=201)
def add_pomodoro(payload: Pomodoro, db: Database, account: Account):
    owner = account["id"]
    # Serialize creations for the same account so concurrent requests respect the ESP32 capacity.
    db.execute("SELECT id FROM accounts WHERE id = %s FOR NO KEY UPDATE", (owner,))
    count = db.execute("SELECT count(*) AS total FROM pomodoros WHERE owner_id = %s", (owner,)).fetchone()
    if count["total"] >= MAX_POMODOROS:
        raise HTTPException(422, "pomodoro_limit")
    return db.execute(f"""
        INSERT INTO pomodoros (owner_id, work_minutes, break_minutes) VALUES (%s, %s, %s)
        RETURNING {configuration}
    """, (owner, payload.workMinutes, payload.breakMinutes)).fetchone()


@router.put("/pomodoros/{pomodoro_id}")
def update_pomodoro(pomodoro_id: PomodoroId, payload: Pomodoro, db: Database, account: Account):
    row = db.execute(f"""
        UPDATE pomodoros SET work_minutes = %s, break_minutes = %s WHERE id = %s AND owner_id = %s
        RETURNING {configuration}
    """, (payload.workMinutes, payload.breakMinutes, pomodoro_id, account["id"])).fetchone()
    if row is None:
        raise HTTPException(404, "resource_not_found")
    return row


@router.delete("/pomodoros/{pomodoro_id}", status_code=204)
def delete_pomodoro(pomodoro_id: PomodoroId, db: Database, account: Account):
    result = db.execute("DELETE FROM pomodoros WHERE id = %s AND owner_id = %s",
                        (pomodoro_id, account["id"]))
    if result.rowcount == 0:
        raise HTTPException(404, "resource_not_found")


@router.get("/devices/sync/pomodoros")
def sync_pomodoros(db: Database, device: Device):
    rows = db.execute(f"""
        SELECT {durations} FROM pomodoros WHERE owner_id = %s ORDER BY id
    """, (device["owner_id"],)).fetchall()
    return {"schemaVersion": 1, "pomodoros": rows}
