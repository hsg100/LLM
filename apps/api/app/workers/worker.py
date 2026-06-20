"""RQ worker entrypoint with DB + Redis readiness checks."""

from __future__ import annotations

import logging

from rq import Worker

from app.db import init_db
from app.workers.queue import get_queue, get_redis, wait_for_redis


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("fieldmap.worker")


def main() -> None:
    logger.info("worker: waiting for redis…")
    wait_for_redis()
    logger.info("worker: initializing db…")
    init_db()
    queue = get_queue()
    logger.info("worker: ready, listening on queue '%s'", queue.name)
    worker = Worker([queue], connection=get_redis())
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
