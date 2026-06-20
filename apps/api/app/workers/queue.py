"""RQ queue + helpers, with a startup-time Redis reachability check."""

from __future__ import annotations

import logging
import time

from redis import Redis
from redis.exceptions import RedisError
from rq import Queue

from app.config import get_settings


logger = logging.getLogger("fieldmap.queue")

_redis_conn: Redis | None = None
_queue: Queue | None = None


def get_redis() -> Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = Redis.from_url(get_settings().redis_url)
    return _redis_conn


def get_queue() -> Queue:
    global _queue
    if _queue is None:
        _queue = Queue("landscape", connection=get_redis(), default_timeout=3600)
    return _queue


def wait_for_redis() -> None:
    """Block until Redis answers PING or attempts exhaust."""
    s = get_settings()
    attempts = max(1, s.redis_connect_attempts)
    backoff = max(0.1, s.redis_connect_backoff_seconds)
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            if get_redis().ping():
                logger.info("redis: ping ok")
                return
        except RedisError as e:
            last_exc = e
            logger.warning(
                "redis not ready (attempt %d/%d): %s",
                i + 1,
                attempts,
                str(e)[:200],
            )
            time.sleep(backoff)
    assert last_exc is not None
    raise last_exc
