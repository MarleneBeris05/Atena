from fastapi import APIRouter, HTTPException, Response
from psycopg import sql
from psycopg.types.json import Jsonb

from .auth import Account
from .db import Database
from .models import ImportLibrary, Library, ResourceId, Review, Subject, Topic

router = APIRouter(prefix="/library", tags=["library"])
parents = {"topics": ("subject_id", "subjectId", "subjects"), "reviews": ("topic_id", "topicId", "topics")}


def lock_account(db, owner, mode="UPDATE"):
    db.execute(sql.SQL("SELECT id FROM accounts WHERE id = %s FOR {}").format(sql.SQL(mode)), (owner,))


def select_entries(db, owner, table, entry_id=None):
    cols = sql.SQL("id, data")
    if table in parents:
        column, wire_name, _ = parents[table]
        cols += sql.SQL(", {} AS {}").format(sql.Identifier(column), sql.Identifier(wire_name))
    query = sql.SQL("SELECT {} FROM {} WHERE owner_id = %s").format(cols, sql.Identifier(table))
    params = (owner,)
    if entry_id is not None:
        query += sql.SQL(" AND id = %s")
        params += (entry_id,)
    query += sql.SQL(" ORDER BY created_at, id")
    return [{**row.pop("data"), **row} for row in db.execute(query, params).fetchall()]


def snapshot(db, owner):
    return {table: select_entries(db, owner, table) for table in ("subjects", "topics", "reviews")}


def parent_exists(db, owner, table, entry):
    if table not in parents:
        return True
    _, field, parent_table = parents[table]
    statement = sql.SQL("SELECT 1 FROM {} WHERE owner_id = %s AND id = %s").format(sql.Identifier(parent_table))
    return db.execute(statement, (owner, entry[field])).fetchone() is not None


def values_for(table, entry):
    payload = dict(entry)
    payload.pop("id")
    fields = ["data"]
    values = []
    if table in parents:
        column, wire_name, _ = parents[table]
        fields.insert(0, column)
        values.append(payload.pop(wire_name))
    return fields, [*values, Jsonb(payload)]


def insert_entry(db, owner, table, entry):
    fields, values = values_for(table, entry)
    columns = ["owner_id", "id", *fields]
    statement = sql.SQL("INSERT INTO {} ({}) VALUES ({}) ON CONFLICT (owner_id, id) DO NOTHING").format(
        sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.SQL(", ").join([sql.Placeholder()] * len(columns)),
    )
    return db.execute(statement, (owner, entry["id"], *values)).rowcount == 1


def known_import_id(db, owner, table, entry_id):
    return db.execute("""
        SELECT 1 FROM imported_ids WHERE owner_id = %s AND kind = %s AND resource_id = %s
    """, (owner, table, entry_id)).fetchone() is not None


def save_entry(db, owner, table, payload, entry_id=None):
    lock_account(db, owner)
    entry = payload.model_dump()
    requested_id = entry["id"]
    current = select_entries(db, owner, table, requested_id)
    if entry_id is None:
        if current:
            if current[0] == entry:
                return entry
            raise HTTPException(409, "resource_conflict")
        if known_import_id(db, owner, table, requested_id):
            raise HTTPException(409, "resource_conflict")
    elif entry_id != requested_id or not current:
        raise HTTPException(404, "resource_not_found")
    if not parent_exists(db, owner, table, entry):
        raise HTTPException(404, "resource_not_found")
    if entry_id is None:
        insert_entry(db, owner, table, entry)
    else:
        fields, values = values_for(table, entry)
        assignments = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(field)) for field in fields)
        statement = sql.SQL("UPDATE {} SET {} WHERE owner_id = %s AND id = %s").format(sql.Identifier(table), assignments)
        db.execute(statement, (*values, owner, entry_id))
    return entry


def remember_import(db, owner, table, entry_id):
    return db.execute("""
        INSERT INTO imported_ids (owner_id, kind, resource_id) VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
    """, (owner, table, entry_id)).rowcount == 1


def delete_entry(db, owner, table, entry_id):
    statement = sql.SQL("DELETE FROM {} WHERE owner_id = %s AND id = %s").format(sql.Identifier(table))
    if db.execute(statement, (owner, entry_id)).rowcount == 1:
        remember_import(db, owner, table, entry_id)
    elif not known_import_id(db, owner, table, entry_id):
        raise HTTPException(404, "resource_not_found")
    return Response(status_code=204)


@router.get("", response_model=Library)
def list_library(db: Database, account: Account):
    lock_account(db, account["id"], "SHARE")
    return snapshot(db, account["id"])


@router.post("/import")
def import_library(payload: ImportLibrary, db: Database, account: Account):
    owner = account["id"]
    lock_account(db, owner)
    added = skipped = 0
    for table, entries in payload.model_dump().items():
        for entry in entries:
            if (parent_exists(db, owner, table, entry)
                    and remember_import(db, owner, table, entry["id"])
                    and insert_entry(db, owner, table, entry)):
                added += 1
            else:
                skipped += 1
    return {"library": snapshot(db, owner), "added": added, "skipped": skipped}


@router.post("/subjects", response_model=Subject, status_code=201)
def create_subject(payload: Subject, db: Database, account: Account):
    return save_entry(db, account["id"], "subjects", payload)


@router.put("/subjects/{entry_id}", response_model=Subject)
def edit_subject(entry_id: ResourceId, payload: Subject, db: Database, account: Account):
    return save_entry(db, account["id"], "subjects", payload, entry_id)


@router.post("/topics", response_model=Topic, status_code=201)
def create_topic(payload: Topic, db: Database, account: Account):
    return save_entry(db, account["id"], "topics", payload)


@router.put("/topics/{entry_id}", response_model=Topic)
def edit_topic(entry_id: ResourceId, payload: Topic, db: Database, account: Account):
    return save_entry(db, account["id"], "topics", payload, entry_id)


@router.post("/reviews", response_model=Review, status_code=201)
def create_review(payload: Review, db: Database, account: Account):
    return save_entry(db, account["id"], "reviews", payload)


@router.put("/reviews/{entry_id}", response_model=Review)
def edit_review(entry_id: ResourceId, payload: Review, db: Database, account: Account):
    return save_entry(db, account["id"], "reviews", payload, entry_id)


@router.delete("/topics/{entry_id}", status_code=204)
def delete_topic(entry_id: ResourceId, db: Database, account: Account):
    owner = account["id"]
    lock_account(db, owner)
    db.execute("""
        INSERT INTO imported_ids (owner_id, kind, resource_id)
        SELECT owner_id, 'reviews', id FROM reviews WHERE owner_id = %s AND topic_id = %s
        ON CONFLICT DO NOTHING
    """, (owner, entry_id))
    return delete_entry(db, owner, "topics", entry_id)


@router.delete("/reviews/{entry_id}", status_code=204)
def delete_review(entry_id: ResourceId, db: Database, account: Account):
    lock_account(db, account["id"])
    return delete_entry(db, account["id"], "reviews", entry_id)
