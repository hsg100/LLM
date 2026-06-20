"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, apiUrl, Job, JobEvent } from "../../../lib/api";

type StageStatus = "done" | "active" | "pending";
type EventLevel = "ok" | "warn" | "info" | "err";

const STAGE_DEFS: { key: string; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "searching", label: "Searching arXiv" },
  { key: "deduplicating", label: "Deduplicating" },
  { key: "embedding_ranking", label: "Embedding & ranking" },
  { key: "downloading_pdfs", label: "Downloading PDFs" },
  { key: "parsing_pdfs", label: "Parsing PDFs" },
  { key: "extracting", label: "Extracting notes" },
  { key: "synthesising", label: "Synthesising landscape" },
  { key: "concepts", label: "Generating concepts" },
  { key: "active_recall", label: "Quiz & flashcards" },
];
const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGE_DEFS.map((s, i) => [s.key, i])
);

function fmtTime(iso: string): string {
  try {
    const s = iso.endsWith("Z") ? iso : iso + "Z";
    return new Date(s).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return iso;
  }
}

function levelOf(ev: JobEvent): EventLevel {
  const meta = (ev.meta || {}) as Record<string, any>;
  if (meta.error_type || /fail|error/i.test(ev.message)) return "err";
  if (meta.fallback || meta.source === "stub" || /warn|fallback/i.test(ev.message))
    return "warn";
  if (/ok|done|kept|complete|finished/i.test(ev.message)) return "ok";
  return "info";
}

function levelColor(level: EventLevel): string {
  return level === "ok"
    ? "var(--good)"
    : level === "warn"
    ? "var(--warn)"
    : level === "err"
    ? "var(--bad)"
    : "#6a8cc0";
}

function detailFor(stageKey: string, events: JobEvent[]): string {
  // Pick the most recent event whose stage matches this key.
  const matching = events.filter((e) => e.stage === stageKey);
  const last = matching[matching.length - 1];
  const meta = (last?.meta || {}) as Record<string, any>;
  if (typeof meta.completed === "number" && typeof meta.total === "number" && meta.total > 0) {
    return `${meta.completed} / ${meta.total} · ${Math.round(meta.percent ?? (meta.completed / meta.total) * 100)}%`;
  }
  return last?.message.slice(0, 60) || "";
}

function countedStageProgress(stageKey: string, events: JobEvent[]): string | null {
  if (stageKey !== "downloading_pdfs" && stageKey !== "parsing_pdfs") return null;
  const matching = events.filter((e) => e.stage === stageKey && e.meta);
  const last = matching[matching.length - 1];
  const meta = (last?.meta || {}) as Record<string, any>;
  if (typeof meta.completed !== "number" || typeof meta.total !== "number" || meta.total <= 0) {
    return null;
  }
  const percent = Math.round(meta.percent ?? (meta.completed / meta.total) * 100);
  return `${meta.completed} of ${meta.total} PDFs · ${percent}%`;
}

function latestMeaningfulEvent(events: JobEvent[]): JobEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.stage === "done" && /Pipeline complete/i.test(ev.message)) return ev;
    if (ev.message && ev.message.trim()) return ev;
  }
  return null;
}

function currentActivity(job: Job | null, events: JobEvent[]): {
  title: string;
  detail: string;
  meta: Record<string, any>;
  level: EventLevel;
  ts: string | null;
} {
  if (!job) {
    return {
      title: "Loading job state",
      detail: "Waiting for the first job snapshot from the API.",
      meta: {},
      level: "info",
      ts: null,
    };
  }
  if (job.stage === "failed") {
    return {
      title: "Job failed",
      detail: job.error || latestMeaningfulEvent(events)?.message || "The pipeline stopped before completion.",
      meta: (latestMeaningfulEvent(events)?.meta || {}) as Record<string, any>,
      level: "err",
      ts: latestMeaningfulEvent(events)?.ts || job.finished_at,
    };
  }
  if (job.stage === "done") {
    const last = latestMeaningfulEvent(events);
    return {
      title: "Pipeline complete",
      detail: last?.message || "Landscape is ready.",
      meta: (last?.meta || {}) as Record<string, any>,
      level: "ok",
      ts: last?.ts || job.finished_at,
    };
  }
  const stageLabel = STAGE_DEFS[STAGE_INDEX[job.stage]]?.label || job.stage;
  const lastForStage = [...events].reverse().find((e) => e.stage === job.stage);
  const last = lastForStage || latestMeaningfulEvent(events);
  return {
    title: stageLabel,
    detail: last?.message || "Waiting for the next pipeline event.",
    meta: (last?.meta || {}) as Record<string, any>,
    level: last ? levelOf(last) : "info",
    ts: last?.ts || null,
  };
}

function activityMetaRows(meta: Record<string, any>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (typeof meta.completed === "number" && typeof meta.total === "number") {
    rows.push({ label: "Progress", value: `${meta.completed} / ${meta.total}` });
  }
  if (typeof meta.percent === "number") rows.push({ label: "Percent", value: `${Math.round(meta.percent)}%` });
  if (typeof meta.candidate_count === "number") rows.push({ label: "Candidates", value: String(meta.candidate_count) });
  if (typeof meta.ranked_count === "number") rows.push({ label: "Ranked", value: String(meta.ranked_count) });
  if (typeof meta.chunks_supplied_to_extraction === "number") {
    rows.push({ label: "Chunks", value: String(meta.chunks_supplied_to_extraction) });
  }
  if (typeof meta.grounded_fields === "number") rows.push({ label: "Grounded", value: String(meta.grounded_fields) });
  if (typeof meta.ungrounded_fields === "number") rows.push({ label: "Ungrounded", value: String(meta.ungrounded_fields) });
  if (typeof meta.clusters === "number") rows.push({ label: "Clusters", value: String(meta.clusters) });
  if (typeof meta.reading_path_items === "number") rows.push({ label: "Reading path", value: String(meta.reading_path_items) });
  if (typeof meta.concepts_persisted === "number") rows.push({ label: "Concepts", value: String(meta.concepts_persisted) });
  if (typeof meta.error_type === "string") rows.push({ label: "Error", value: meta.error_type });
  if (typeof meta.provider === "string") rows.push({ label: "Provider", value: meta.provider });
  if (typeof meta.model === "string") rows.push({ label: "Model", value: meta.model });
  return rows.slice(0, 6);
}

export default function JobPage({ params }: { params: { id: string } }) {
  const search = useSearchParams();
  const landscapeId = search.get("landscape");
  const [job, setJob] = useState<Job | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const j = await apiGet<Job>(`/api/jobs/${params.id}`);
        if (stopped) return;
        setJob(j);
        setPollErr(null);
        if (j.stage === "done" || j.stage === "failed") return;
        setTimeout(tick, 1500);
      } catch (e: any) {
        if (stopped) return;
        setPollErr(e.message || String(e));
        setTimeout(tick, 3000);
      }
    }
    tick();
    return () => {
      stopped = true;
    };
  }, [params.id]);

  useEffect(() => {
    const es = new EventSource(apiUrl(`/api/jobs/${params.id}/events`, false));
    const onProgress = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data) as JobEvent;
        setJob((prev) =>
          prev
            ? {
                ...prev,
                stage: event.stage,
                progress: event.progress,
                events: [...prev.events, event].slice(-200),
              }
            : prev
        );
      } catch {
        /* polling remains the fallback */
      }
    };
    const onComplete = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data) as JobEvent;
        setJob((prev) =>
          prev
            ? {
                ...prev,
                stage: event.stage,
                progress: event.progress,
                events: [...prev.events, event].slice(-200),
              }
            : prev
        );
      } catch {
        /* polling remains the fallback */
      } finally {
        es.close();
      }
    };
    es.addEventListener("progress", onProgress);
    es.addEventListener("complete", onComplete);
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [params.id]);

  useEffect(() => {
    if (!job?.started_at) return;
    const iso = job.started_at;
    const start = new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    if (job.stage === "done" || job.stage === "failed") return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job?.started_at, job?.stage]);

  const events = job?.events ?? [];
  const currentStageIdx = job ? STAGE_INDEX[job.stage] ?? -1 : -1;
  const stages = STAGE_DEFS.map((s, i) => {
    let status: StageStatus = "pending";
    if (job?.stage === "done") status = "done";
    else if (i < currentStageIdx) status = "done";
    else if (i === currentStageIdx) status = "active";
    return {
      ...s,
      status,
      detail:
        status === "done"
          ? detailFor(s.key, events) || "done"
          : status === "active"
          ? detailFor(s.key, events) || "running…"
          : "pending",
    };
  });

  const progress = Math.round(((job?.progress ?? 0) as number) * 100);
  const stageCountProgress = job ? countedStageProgress(job.stage, events) : null;
  const activity = currentActivity(job, events);
  const activityRows = activityMetaRows(activity.meta);
  const isDone = job?.stage === "done";
  const isFailed = job?.stage === "failed";
  const isRunning = !isDone && !isFailed;

  const usedFallback = useMemo(
    () =>
      events.some(
        (e) =>
          (e.meta as any)?.fallback === true || (e.meta as any)?.source === "stub"
      ),
    [events]
  );

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "32px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 7, flexWrap: "wrap" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {isFailed ? "Landscape job failed" : isDone ? "Landscape ready" : "Building landscape"}
        </h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "4px 11px",
            borderRadius: 999,
            background: isDone
              ? "var(--good-bg)"
              : isFailed
              ? "rgba(207,77,111,.13)"
              : "var(--accent-bg)",
          }}
        >
          <span
            className={isRunning ? "fm-pulse" : ""}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isDone ? "var(--good)" : isFailed ? "var(--bad)" : "var(--accent)",
            }}
          />
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: isDone
                ? "var(--good)"
                : isFailed
                ? "var(--bad)"
                : "var(--accent-ink)",
              letterSpacing: "0.05em",
            }}
          >
            {isDone ? "READY" : isFailed ? "FAILED" : "RUNNING"}
          </span>
        </span>
        {usedFallback && (
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 6,
              background: "var(--warm)",
              color: "var(--warn)",
              border: "1px solid var(--warm-bd)",
            }}
          >
            DEV FALLBACK
          </span>
        )}
      </div>
      <p
        className="font-mono"
        style={{
          fontSize: 13,
          color: "var(--t3)",
          margin: "0 0 24px",
        }}
      >
        job {params.id.slice(0, 8)} ·{" "}
        {job?.started_at
          ? `started ${fmtTime(job.started_at)} · elapsed ${formatElapsed(elapsed)}`
          : "queued"}
      </p>

      {pollErr && (
        <div
          style={{
            fontSize: 12,
            color: "var(--warn)",
            background: "var(--warm)",
            border: "1px solid var(--warm-bd)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 16,
          }}
        >
          Couldn't reach the API: <span className="font-mono">{pollErr}</span>. Retrying…
        </div>
      )}

      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 14,
          background: "var(--panel)",
          padding: "16px 18px",
          marginBottom: 20,
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span
            className={isRunning ? "fm-pulse" : ""}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: levelColor(activity.level),
              marginTop: 6,
              flex: "none",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{activity.title}</div>
              {activity.ts && (
                <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>
                  last update {fmtTime(activity.ts)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.55, marginTop: 5 }}>
              {activity.detail}
            </div>
            {activityRows.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {activityRows.map((row) => (
                  <span
                    key={`${row.label}:${row.value}`}
                    className="font-mono"
                    style={{
                      fontSize: 10.5,
                      color: "var(--t3)",
                      border: "1px solid var(--bd)",
                      borderRadius: 6,
                      background: "var(--raised)",
                      padding: "4px 7px",
                    }}
                  >
                    {row.label}: {row.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>
            {STAGE_DEFS[currentStageIdx]?.label ?? "—"} · stage{" "}
            {currentStageIdx >= 0 ? currentStageIdx + 1 : 0} of {STAGE_DEFS.length}
            {stageCountProgress ? ` · ${stageCountProgress}` : ""}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: "var(--accent-ink)" }}
          >
            {progress}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--raised)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg,#b8431f,#e0613a)",
              transition: "width .3s",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "390px 1fr",
          gap: 22,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 16,
            background: "var(--panel)",
            padding: 8,
            boxShadow: "var(--shadow)",
          }}
        >
          {stages.map((s) => (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "12px 13px",
                borderRadius: 9,
                background: s.status === "active" ? "var(--accent-bg)" : "transparent",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flex: "none",
                  background:
                    s.status === "done"
                      ? "var(--good)"
                      : s.status === "active"
                      ? "var(--accent)"
                      : "var(--bd)",
                }}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 500,
                  color: s.status === "pending" ? "var(--t4)" : "var(--t1)",
                }}
              >
                {s.label}
              </div>
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: "var(--t3)",
                  textAlign: "right",
                  maxWidth: 200,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.detail}
              </span>
              {s.status === "done" && (
                <svg width="13" height="13" viewBox="0 0 15 15">
                  <path
                    d="M3 8l3 3 6-7"
                    stroke="var(--good)"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {s.status === "active" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 15 15"
                  className="fm-spin"
                >
                  <circle cx="7.5" cy="7.5" r="5.5" stroke="var(--bd)" strokeWidth="1.6" fill="none" />
                  <path
                    d="M7.5 2a5.5 5.5 0 015.5 5.5"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 16,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--bd)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>Event log</span>
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--t4)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                className="fm-blink"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--good)",
                }}
              />
              live · poll
            </span>
          </div>
          <div
            style={{
              padding: "8px 0",
              maxHeight: 440,
              overflowY: "auto",
              fontFamily: "'Geist Mono', ui-monospace, monospace",
              fontSize: 11.5,
            }}
          >
            {events.length === 0 && (
              <div style={{ padding: "10px 16px", color: "var(--t4)" }}>
                no events yet…
              </div>
            )}
            {events.map((e, i) => {
              const lv = levelOf(e);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 11,
                    padding: "6px 16px",
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: "var(--t4)", flex: "none", width: 64 }}>
                    {fmtTime(typeof e.ts === "string" ? e.ts : String(e.ts))}
                  </span>
                  <span style={{ color: levelColor(lv), flex: "none", width: 110 }}>
                    {e.stage}
                  </span>
                  <span style={{ color: "var(--t2)", flex: 1 }}>{e.message}</span>
                </div>
              );
            })}
            {isRunning && (
              <div style={{ display: "flex", gap: 11, padding: "6px 16px" }}>
                <span style={{ color: "var(--t4)", width: 64 }} />
                <span style={{ color: "var(--accent-ink)", width: 110 }}>
                  {job?.stage}
                </span>
                <span style={{ color: "var(--t3)" }}>
                  {activity.detail} <span className="fm-blink">▌</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {(isDone || isFailed) && (
        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {isDone && landscapeId && (
            <>
              <Link
                href={`/landscape/${landscapeId}`}
                style={primaryBtn}
              >
                Open landscape →
              </Link>
              <Link
                href={`/landscape/${landscapeId}/papers`}
                style={secondaryBtn}
              >
                Papers
              </Link>
            </>
          )}
          {isFailed && (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--bad)",
                  background: "rgba(207,77,111,.10)",
                  border: "1px solid var(--bad)",
                  borderRadius: 12,
                  padding: "12px 16px",
                  flex: 1,
                }}
              >
                <strong>Job failed.</strong> {job?.error || "(no error message)"}
              </div>
              <Link href="/search" style={secondaryBtn}>
                New landscape
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderRadius: 10,
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  boxShadow: "0 2px 10px rgba(224,97,58,.28)",
};
const secondaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderRadius: 10,
  background: "var(--raised)",
  border: "1px solid var(--bd)",
  color: "var(--t1)",
  fontSize: 13,
};
