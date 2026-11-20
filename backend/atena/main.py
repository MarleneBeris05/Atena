from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import auth, device_pairing, devices, flashcards, library
from .config import allowed_origins, connection, database_url, session_secret


@asynccontextmanager
async def lifespan(_app):
    database_url()
    session_secret()
    yield


app = FastAPI(title="Atena", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router)
app.include_router(library.router)
app.include_router(flashcards.router)
app.include_router(device_pairing.router)
app.include_router(devices.router)


@app.middleware("http")
async def no_sensitive_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(("/auth", "/library", "/devices")) and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
@app.exception_handler(psycopg.DataError)
async def invalid_request(_request, _error):
    return JSONResponse({"detail": "invalid_data"}, status_code=422)


@app.exception_handler(psycopg.OperationalError)
async def database_unavailable(_request, _error):
    return JSONResponse({"detail": "database_unavailable"}, status_code=503)


@app.get("/health")
def health():
    try:
        with connection() as db:
            db.execute("SELECT 1 FROM reviews LIMIT 1")
            db.execute("SELECT 1 FROM device_decks LIMIT 1")
    except psycopg.Error:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ok"}
