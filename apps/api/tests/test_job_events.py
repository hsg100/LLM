"""DB-backed tests for the append-only job_events flow + cancellation.

These require a reachable Postgres (CI provides one and runs `alembic upgrade
head` first). They skip cleanly when no database is available so the rest of
the unit suite still runs offline.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import JobEvent, Landscape, SearchJob
from app.pipeline import JobStage
from app.workers import landscape_job as lj


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@pytest.fixture()
def job_id():
    with session_scope() as s:
        ls = Landscape(topic="job-events test")
        s.add(ls)
        s.flush()
        ls_id = ls.id
        job = SearchJob(landscape_id=ls_id, stage=JobStage.QUEUED.value)
        s.add(job)
        s.flush()
        jid = job.id
    yield jid
    with session_scope() as s:
        for ev in s.exec(select(JobEvent).where(JobEvent.job_id == jid)).all():
            s.delete(ev)
        job = s.get(SearchJob, jid)
        if job:
            s.delete(job)
        ls = s.get(Landscape, ls_id)
        if ls:
            s.delete(ls)


def test_events_are_append_only_with_monotonic_seq(job_id):
    lj._set_stage(job_id, JobStage.SEARCHING.value, 0.1, "start")
    lj._append_event(job_id, JobStage.EXTRACTING.value, "a", 0.5)
    # A lower progress event must NOT lower the job's recorded progress.
    lj._append_event(job_id, JobStage.EXTRACTING.value, "b", 0.4)

    with session_scope() as s:
        rows = s.exec(
            select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.seq)
        ).all()
        assert [r.message for r in rows] == ["start", "a", "b"]
        seqs = [int(r.seq) for r in rows]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == 3  # strictly unique, monotonic
        job = s.get(SearchJob, job_id)
        assert job.progress == pytest.approx(0.5)  # GREATEST preserved


def test_concurrent_appends_are_not_lost(job_id):
    """The old JSONB read-modify-write lost events under concurrency; the
    append-only table must persist every one."""

    async def run() -> None:
        await asyncio.gather(
            *(
                asyncio.to_thread(
                    lj._append_event, job_id, JobStage.EXTRACTING.value, f"m{i}", 0.5
                )
                for i in range(25)
            )
        )

    asyncio.run(run())

    with session_scope() as s:
        rows = s.exec(select(JobEvent).where(JobEvent.job_id == job_id)).all()
        assert len(rows) == 25
        assert len({int(r.seq) for r in rows}) == 25


def test_cancellation_flag_is_observed(job_id):
    assert lj._is_cancel_requested(job_id) is False
    lj._raise_if_cancelled(job_id)  # no-op when not requested

    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        job.cancel_requested = True
        s.add(job)

    assert lj._is_cancel_requested(job_id) is True
    with pytest.raises(lj.JobCancelled):
        lj._raise_if_cancelled(job_id)
