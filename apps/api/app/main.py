from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.db import init_db, session_scope
from app.services.embeddings import embedding_metadata, get_embedding_provider, validate_embedding_configuration
from app.users import ensure_default_user
from app.workers.queue import wait_for_redis


logging.basicConfig(
    level=getattr(logging, get_settings().log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("fieldmap.api")


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    s = get_settings()
    logger.info(
        "api startup env=%s llm_provider=%s embedding_provider=%s",
        s.env,
        s.llm_provider,
        s.embedding_provider,
    )
    validate_embedding_configuration(s)
    try:
        wait_for_redis()
    except Exception as e:  # noqa: BLE001 — keep API up so /health works for debugging
        logger.error("api startup: redis not reachable: %s", e)
    try:
        init_db()
        with session_scope() as session:
            ensure_default_user(session)
    except Exception as e:  # noqa: BLE001
        logger.error("api startup: init_db failed: %s", e)
    yield


app = FastAPI(title="FieldMap API", version="0.1.0", lifespan=lifespan)

settings = get_settings()
allowed_origins = [
    origin.strip()
    for origin in (settings.cors_allowed_origins or "").split(",")
    if origin.strip()
]
if settings.is_development and not allowed_origins:
    allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=settings.cors_allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready(response: Response) -> dict[str, object]:
    """Deeper readiness check: DB + Redis + settings snapshot.

    Returns HTTP 503 when a hard dependency (DB or Redis) is unavailable, so
    this can be used directly as a deployment readiness probe.
    """
    s = get_settings()
    out: dict[str, object] = {
        "env": s.env,
        "llm_provider": s.llm_provider,
        "embedding_provider": s.embedding_provider,
        "embedding_model": s.embedding_model,
        "embedding_dim": s.embedding_dim,
        "dev_fallback": s.enable_dev_fallback,
        "embedding_dev_fallback": s.enable_embedding_dev_fallback,
    }
    # DB
    try:
        from sqlalchemy import text

        from app.db import engine

        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        out["db"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["db"] = f"error: {type(e).__name__}: {str(e)[:160]}"
    # Redis
    try:
        from app.workers.queue import get_redis

        get_redis().ping()
        out["redis"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["redis"] = f"error: {type(e).__name__}: {str(e)[:160]}"
    if out.get("db") != "ok" or out.get("redis") != "ok":
        response.status_code = 503
    return out


@app.get("/ready/embeddings")
async def ready_embeddings() -> dict[str, object]:
    """Embed a tiny phrase with the configured provider and report dimensions."""
    try:
        provider = get_embedding_provider()
        vectors = await provider.embed(["FieldMap embedding smoke test"])
        vector = vectors[0] if vectors else []
        returned_dim = len(vector)
        return {
            "ok": returned_dim == provider.dim,
            **embedding_metadata(provider),
            "returned_dim": returned_dim,
            "plain_list": isinstance(vector, list) and all(isinstance(x, float) for x in vector),
        }
    except Exception as e:  # noqa: BLE001
        s = get_settings()
        return {
            "ok": False,
            "embedding_provider": s.embedding_provider,
            "embedding_model": s.embedding_model,
            "embedding_dim": s.embedding_dim,
            "error_type": type(e).__name__,
            "error_message": str(e)[:240],
        }


app.include_router(router, prefix="/api")
