from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, field_validator

from .models import ResourceId

INTERVALS = (1, 3, 7, 14, 30)
MAX_AGENDA = 48
Clock = Annotated[str, StringConstraints(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]


class SessionDate(BaseModel):
    date: date
    time: Clock

    @field_validator("date")
    @classmethod
    def rtc_range(cls, value):
        if not 2024 <= value.year <= 2099:
            raise ValueError("La fecha debe estar entre 2024 y 2099.")
        return value


class PlanDates(BaseModel):
    topicId: ResourceId
    deviceId: UUID
    startDate: date
    examDate: date
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    timeZone: Annotated[str, StringConstraints(max_length=80)]
    time: Clock
    minutes: Annotated[int, Field(strict=True, ge=1, le=180)]
    sessions: Annotated[list[SessionDate], Field(min_length=1, max_length=MAX_AGENDA)] | None = None

    @field_validator("startDate", "examDate")
    @classmethod
    def rtc_range(cls, value):
        return SessionDate.rtc_range(value)


class ReviewResult(BaseModel):
    id: UUID
    status: Annotated[str, StringConstraints(pattern=r"^(completed|skipped)$")]
    finishedAt: AwareDatetime


def problem(field, message, status=422):
    raise HTTPException(status, {"field": field, "message": message})


def suggest_dates(start: date, exam: date) -> list[date]:
    last = (exam - start).days - 1
    if last < 1:
        return []
    if last >= 30:
        offsets = list(INTERVALS) + list(range(44, last, 14))
        if last - 30 >= 7 and offsets[-1] != last:
            offsets.append(last)
    elif last == 1:
        offsets = [1]
    else:
        count = min(last, len(INTERVALS))
        offsets = [1]
        for index in range(1, count - 1):
            scaled = 1 + ((INTERVALS[index] - 1) * (last - 1) + 14) // 29
            offsets.append(max(offsets[-1] + 1, min(scaled, last - (count - 1 - index))))
        offsets.append(last)
    return [start + timedelta(days=offset) for offset in offsets]


def to_utc(day, clock, zone, field):
    local = datetime.combine(day, time.fromisoformat(clock))
    first = local.replace(tzinfo=zone, fold=0)
    second = local.replace(tzinfo=zone, fold=1)
    instant = first.astimezone(timezone.utc)
    if first.utcoffset() != second.utcoffset() or instant.astimezone(zone).replace(tzinfo=None) != local:
        problem(field, f"El {day} a las {clock} la hora local es ambigua o no existe. Elige otra hora.")
    return instant


def build_sessions(plan: PlanDates, now: datetime):
    try:
        zone = ZoneInfo(plan.timeZone)
    except (ZoneInfoNotFoundError, ValueError):
        problem("timeZone", "Selecciona una zona horaria válida.")
    if (plan.examDate - plan.startDate).days > 366:
        problem("examDate", "La fecha límite debe estar dentro del año siguiente al inicio.")
    proposed = suggest_dates(plan.startDate, plan.examDate)
    if not proposed:
        problem("examDate", "Debe haber al menos un día entre el estudio inicial y el examen.")

    today = now.astimezone(zone).date()
    selected = plan.sessions or [SessionDate(date=day, time=plan.time) for day in proposed if day >= today]
    result = []
    dates = set()
    for index, entry in sorted(enumerate(selected), key=lambda pair: (pair[1].date, pair[1].time)):
        field = f"sessions.{index}" if plan.sessions else "time"
        if entry.date in dates:
            problem(field, "Usa un solo repaso por fecha en el plan.")
        if entry.date < plan.startDate or entry.date >= plan.examDate:
            problem(field, "El repaso debe quedar dentro del plan y antes del examen.")
        if entry.date == plan.startDate and (plan.sessions is None or entry.date != today):
            problem(field, "Solo puedes ajustar un repaso al día de inicio si es hoy y la hora sigue siendo futura.")
        starts_at = to_utc(entry.date, entry.time, zone, field)
        if starts_at <= now:
            if plan.sessions:
                problem(field, "Elige una fecha y hora futuras.")
            continue
        dates.add(entry.date)
        result.append({"date": entry.date, "time": entry.time, "startsAt": starts_at})
    if not result:
        problem("examDate", "No hay repasos futuros disponibles antes del examen.")
    return result
