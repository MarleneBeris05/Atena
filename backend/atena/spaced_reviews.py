from datetime import datetime, time, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .auth import Account
from .db import Database
from .device_pairing import Device
from .spaced_schedule import MAX_AGENDA, PlanDates, ReviewResult, build_sessions, problem


router = APIRouter(tags=["spaced reviews"])


class AgendaReceipt(BaseModel):
    revision: int = Field(strict=True, ge=0, le=2_147_483_647)


class Results(BaseModel):
    results: list[ReviewResult] = Field(min_length=1, max_length=MAX_AGENDA)


def lock_account(db, owner):
    db.execute("SELECT id FROM accounts WHERE id = %s FOR NO KEY UPDATE", (owner,))


def plan_for(db, owner, plan_id):
    row = db.execute("SELECT * FROM spaced_plans WHERE owner_id = %s AND id = %s", (owner, plan_id)).fetchone()
    if row is None:
        raise HTTPException(404, "resource_not_found")
    return row


def sessions_for(db, owner, plan, now, previous=None):
    topic = db.execute("""
        SELECT t.data->>'name' AS topic, s.data->>'name' AS subject
        FROM topics t JOIN subjects s ON (s.owner_id, s.id) = (t.owner_id, t.subject_id)
        WHERE t.owner_id = %s AND t.id = %s
    """, (owner, plan.topicId)).fetchone()
    if not topic or previous and previous["topic_id"] != plan.topicId:
        problem("topicId", "El tema ya no está disponible.")
    linked = db.execute("""
        SELECT 1 FROM devices WHERE id = %s AND owner_id = %s AND revoked_at IS NULL
    """, (plan.deviceId, owner)).fetchone()
    if not linked:
        problem("deviceId", "Elige un dispositivo vinculado a tu cuenta.")

    proposed = build_sessions(plan, now)
    plan_id = previous["id"] if previous else None
    scheduled = db.execute("""
        SELECT s.plan_id, s.local_date, s.starts_at, s.minutes, s.device_id, s.result
        FROM spaced_sessions s JOIN spaced_plans p ON p.id = s.plan_id
        WHERE p.owner_id = %s AND s.cancelled_at IS NULL AND
              (s.plan_id = %s OR (s.device_id = %s AND s.result IS NULL))
    """, (owner, plan_id, plan.deviceId)).fetchall()
    history = {s["local_date"] for s in scheduled if s["plan_id"] == plan_id and
               (s["result"] or s["starts_at"] <= now)}
    if plan.sessions is None:
        proposed = [s for s in proposed if s["date"] not in history]
    if not proposed:
        problem("sessions", "Elige al menos un día futuro sin un repaso previo en este plan.")
    existing = [s for s in scheduled if s["device_id"] == plan.deviceId and not s["result"] and
                (s["plan_id"] != plan_id or s["starts_at"] <= now)]
    if len(existing) + len(proposed) > MAX_AGENDA:
        problem("deviceId", "La agenda de este dispositivo admite hasta 48 repasos pendientes.")

    duration = timedelta(minutes=plan.minutes)
    issues = []
    for position, entry in enumerate(proposed):
        start = entry["startsAt"]
        index = next((i for i, value in enumerate(plan.sessions or [])
                      if (value.date, value.time) == (entry["date"], entry["time"])), position)
        field = f"sessions.{index}"
        if entry["date"] in history:
            issues.append({"field": field, "message": "Este plan ya tiene un repaso anterior en esa fecha."})
        if any(start < s["starts_at"] + timedelta(minutes=s["minutes"]) and
               s["starts_at"] < start + duration for s in existing):
            issues.append({"field": field, "message": "Este horario se cruza con otro repaso del dispositivo."})
    for index, (first, second) in enumerate(zip(proposed, proposed[1:]), 1):
        if first["startsAt"] + duration > second["startsAt"]:
            original = next((i for i, value in enumerate(plan.sessions or [])
                             if (value.date, value.time) == (second["date"], second["time"])), index)
            issues.append({"field": f"sessions.{original}", "message": "Este horario se cruza con el repaso anterior."})
    if issues:
        raise HTTPException(422, {
            "issues": issues,
            **({"sessions": [{"date": s["date"].isoformat(), "time": s["time"]} for s in proposed]}
               if plan.sessions is None else {}),
        })
    return topic, proposed


def update_delivery(db, plan_id, device_id):
    row = db.execute("""
        INSERT INTO spaced_agendas (device_id, revision) VALUES (%s, 1)
        ON CONFLICT (device_id) DO UPDATE SET revision = spaced_agendas.revision + 1
        RETURNING revision
    """, (device_id,)).fetchone()
    db.execute("""
        INSERT INTO spaced_deliveries (plan_id, device_id, revision) VALUES (%s, %s, %s)
        ON CONFLICT (plan_id, device_id) DO UPDATE SET revision = excluded.revision
    """, (plan_id, device_id, row["revision"]))


@router.get("/spaced-plans")
def list_plans(db: Database, account: Account):
    owner = account["id"]
    rows = db.execute("""
        SELECT p.id, p.topic_id AS "topicId", p.subject_name AS "subjectName", p.topic_name AS "topicName",
               p.device_id AS "deviceId", p.start_date AS "startDate", p.exam_date AS "examDate",
               p.reason, p.timezone AS "timeZone", to_char(p.review_time, 'HH24:MI') AS time, p.minutes,
               p.cancelled, EXISTS (
                   SELECT 1 FROM spaced_deliveries x JOIN spaced_agendas a USING (device_id)
                   JOIN devices d ON d.id = x.device_id AND d.revoked_at IS NULL
                   WHERE x.plan_id = p.id AND a.confirmed < x.revision
               ) AS "pendingSync"
        FROM spaced_plans p WHERE p.owner_id = %s ORDER BY p.start_date, p.id
    """, (owner,)).fetchall()
    entries = db.execute("""
        SELECT s.id, s.plan_id, s.local_date AS date, to_char(s.local_time, 'HH24:MI') AS time,
               s.starts_at AS "startsAt", s.minutes, s.reason, COALESCE(s.result, 'scheduled') AS status
        FROM spaced_sessions s JOIN spaced_plans p ON p.id = s.plan_id
        WHERE p.owner_id = %s AND (s.cancelled_at IS NULL OR s.result IS NOT NULL)
        ORDER BY s.starts_at, s.id
    """, (owner,)).fetchall()
    plans = {row["id"]: {**row, "sessions": []} for row in rows}
    for entry in entries:
        if plan := plans.get(entry.pop("plan_id")):
            plan["sessions"].append(entry)
    return {"plans": list(plans.values())}


@router.post("/spaced-plans/preview")
def preview(payload: PlanDates, db: Database, account: Account, planId: UUID | None = None):
    owner = account["id"]
    previous = plan_for(db, owner, planId) if planId else None
    if previous and previous["cancelled"]:
        problem("form", "Este plan ya está cancelado.", 409)
    _, entries = sessions_for(db, owner, payload, datetime.now(timezone.utc), previous)
    return {"sessions": entries}


def save_plan(db, owner, payload, plan_id=None):
    lock_account(db, owner)
    now = datetime.now(timezone.utc)
    previous = plan_for(db, owner, plan_id) if plan_id else None
    if previous and previous["cancelled"]:
        problem("form", "Este plan ya está cancelado.", 409)
    topic, sessions = sessions_for(db, owner, payload, now, previous)
    plan_id = plan_id or uuid4()
    current = {}
    if previous:
        current = {row["starts_at"]: row for row in db.execute("""
            SELECT id, starts_at, device_id FROM spaced_sessions
            WHERE plan_id = %s AND starts_at > %s AND result IS NULL AND cancelled_at IS NULL FOR UPDATE
        """, (plan_id, now)).fetchall()}
    db.execute("""
        INSERT INTO spaced_plans (id, owner_id, topic_id, subject_name, topic_name, device_id,
                                  start_date, exam_date, reason, timezone, review_time, minutes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET device_id = excluded.device_id, start_date = excluded.start_date,
            exam_date = excluded.exam_date, reason = excluded.reason, timezone = excluded.timezone,
            review_time = excluded.review_time, minutes = excluded.minutes
    """, (plan_id, owner, payload.topicId, topic["subject"], topic["topic"], payload.deviceId,
          payload.startDate, payload.examDate, payload.reason, payload.timeZone, time.fromisoformat(payload.time), payload.minutes))
    reused = []
    for entry in sessions:
        start = entry["startsAt"]
        old = current.get(start)
        session_id = old["id"] if old and old["device_id"] == payload.deviceId else uuid4()
        reused.append(session_id)
        db.execute("""
            INSERT INTO spaced_sessions (id, plan_id, device_id, local_date, local_time, starts_at, minutes, reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET local_date = excluded.local_date, local_time = excluded.local_time,
                minutes = excluded.minutes, reason = excluded.reason
        """, (session_id, plan_id, payload.deviceId, entry["date"], time.fromisoformat(entry["time"]),
              start, payload.minutes, payload.reason))
    db.execute("""
        UPDATE spaced_sessions SET cancelled_at = %s
        WHERE plan_id = %s AND starts_at > %s AND result IS NULL AND cancelled_at IS NULL AND id <> ALL(%s)
    """, (now, plan_id, now, reused))
    update_delivery(db, plan_id, payload.deviceId)
    if previous and previous["device_id"] != payload.deviceId:
        update_delivery(db, plan_id, previous["device_id"])
    return {"id": plan_id}


@router.post("/spaced-plans", status_code=201)
def create_plan(payload: PlanDates, db: Database, account: Account):
    return save_plan(db, account["id"], payload)


@router.put("/spaced-plans/{plan_id}")
def edit_plan(plan_id: UUID, payload: PlanDates, db: Database, account: Account):
    return save_plan(db, account["id"], payload, plan_id)


@router.delete("/spaced-plans/{plan_id}", status_code=204)
def cancel_plan(plan_id: UUID, db: Database, account: Account):
    owner = account["id"]
    lock_account(db, owner)
    plan = plan_for(db, owner, plan_id)
    if plan["cancelled"]:
        return
    now = datetime.now(timezone.utc)
    devices = db.execute("""
        UPDATE spaced_sessions SET cancelled_at = %s WHERE plan_id = %s AND result IS NULL AND cancelled_at IS NULL
        RETURNING device_id
    """, (now, plan_id)).fetchall()
    db.execute("UPDATE spaced_plans SET cancelled = true WHERE id = %s", (plan_id,))
    for device_id in {plan["device_id"], *(row["device_id"] for row in devices)}:
        update_delivery(db, plan_id, device_id)


@router.get("/devices/sync/agenda")
def download_agenda(db: Database, device: Device):
    rows = db.execute("""
        SELECT COALESCE(a.revision, 0) AS revision, s.id, s.starts_at, s.minutes, left(p.topic_name, 40) AS topic
        FROM devices d LEFT JOIN spaced_agendas a ON a.device_id = d.id
        LEFT JOIN spaced_sessions s ON s.device_id = d.id AND s.result IS NULL AND s.cancelled_at IS NULL
        LEFT JOIN spaced_plans p ON p.id = s.plan_id WHERE d.id = %s ORDER BY s.starts_at, s.id
    """, (device["id"],)).fetchall()
    return {"schemaVersion": 1, "revision": rows[0]["revision"], "sessions": [
        {"id": row["id"], "start": int(row["starts_at"].timestamp()), "minutes": row["minutes"], "topic": row["topic"]}
        for row in rows if row["id"]
    ]}


@router.post("/devices/sync/agenda/confirm")
def confirm_agenda(payload: AgendaReceipt, db: Database, device: Device):
    if payload.revision == 0:
        return {"revision": 0}
    result = db.execute("""
        UPDATE spaced_agendas SET confirmed = greatest(confirmed, %s)
        WHERE device_id = %s AND revision >= %s
    """, (payload.revision, device["id"], payload.revision))
    if not result.rowcount:
        raise HTTPException(409, "agenda_revision_unavailable")
    return {"revision": payload.revision}


@router.post("/devices/sync/agenda/results")
def sync_review_results(payload: Results, db: Database, device: Device):
    lock_account(db, device["owner_id"])
    acknowledged = []
    for entry in payload.results:
        row = db.execute("""
            SELECT s.result, s.starts_at, s.cancelled_at FROM spaced_sessions s
            JOIN spaced_plans p ON p.id = s.plan_id
            WHERE s.id = %s AND s.device_id = %s AND p.owner_id = %s FOR UPDATE OF s
        """, (entry.id, device["id"], device["owner_id"])).fetchone()
        if not row or entry.finishedAt < row["starts_at"]:
            raise HTTPException(422, "agenda_result_unavailable")
        if not row["result"] and (not row["cancelled_at"] or entry.finishedAt <= row["cancelled_at"]):
            db.execute("UPDATE spaced_sessions SET result = %s, finished_at = %s WHERE id = %s",
                       (entry.status, entry.finishedAt, entry.id))
        acknowledged.append(entry.id)
    return {"acknowledged": acknowledged}
