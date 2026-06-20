from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.db import init_db
from app.services.embeddings import embedding_metadata, get_embedding_provider, validate_embedding_configuration
from app.workers.queue import wait_for_redis


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("fieldmap.api")

app = FastAPI(title="FieldMap API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    s = get_settings()
    logger.info("api startup env=%s llm_provider=%s embedding_provider=%s", s.env, s.llm_provider, s.embedding_provider)
    validate_embedding_configuration(s)
    try:
        wait_for_redis()
    except Exception as e:  # noqa: BLE001 — keep API up so /health works for debugging
        logger.error("api startup: redis not reachable: %s", e)
    try:
        init_db()
    except Exception as e:  # noqa: BLE001
        logger.error("api startup: init_db failed: %s", e)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, object]:
    """Deeper readiness check: DB + Redis + settings snapshot."""
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
