"use client";

// Client runtime for a lesson page (design §7/§9/§10). Receives only the
// minimum data the interaction needs — never the full catalogue and never
// answer keys (grading is server-side).
//
// Responsibilities:
//  • resume: report the furthest-scrolled block as last_block_id (debounced
//    PUT; identical positions are server-side no-ops) and scroll to the
//    stored position on revisit;
//  • checkpoint: collect answers, POST with a client-generated attempt id,
//    render the graded result;
//  • honesty under failure: an unreachable API leaves the lesson fully
//    readable with progress marked unavailable; a 409 catalogue mismatch
//    preserves the attempt locally and retries — nothing is silently lost.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CatalogueMismatchError,
  CheckpointResult,
  clearPendingOperation,
  getLearnProgress,
  postCheckpointAttempt,
  putLessonProgress,
  retryLessonOutbox,
  savePendingCheckpoint,
  savePendingProgress,
} from "../../lib/learn";

export type RuntimeProps = {
  lessonSlug: string;
  lessonVersion: number;
  catalogHash: string;
  blockIds: string[];
  checkpointSlug: string;
  passScore: number;
  questions: { id: string; prompt: string; options: string[] }[];
};

function newAttemptId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function LessonRuntime(props: RuntimeProps) {
  return (
    <>
      <ProgressTracker {...props} />
      <Checkpoint {...props} />
    </>
  );
}

/* ---------------- resume position ---------------- */

function ProgressTracker({ lessonSlug, lessonVersion, catalogHash, blockIds }: RuntimeProps) {
  const [syncState, setSyncState] = useState<
    "idle" | "mismatch" | "offline" | "storage" | "incompatible"
  >("idle");
  const furthest = useRef<number>(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retrying = useRef(false);

  const progressQ = useQuery({
    queryKey: ["learn-progress", lessonSlug],
    queryFn: getLearnProgress,
    retry: 1,
  });
  const mine = progressQ.data?.lessons.find(
    (l) => l.lesson_slug === lessonSlug && l.lesson_version === lessonVersion
  );

  // Scroll to the stored resume position once progress arrives.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !mine?.last_block_id) return;
    restored.current = true;
    document.getElementById(`block-${mine.last_block_id}`)?.scrollIntoView({ block: "start" });
  }, [mine?.last_block_id]);

  const push = useCallback(
    (blockId: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const saved = savePendingProgress({ lessonSlug, lessonVersion, catalogHash, lastBlockId: blockId });
        if (!saved.ok) {
          setSyncState("storage");
          return;
        }
        putLessonProgress({ lessonSlug, lessonVersion, catalogHash, lastBlockId: blockId })
          .then(() => {
            clearPendingOperation(saved.entry.id);
            setSyncState("idle");
          })
          .catch((e) =>
            setSyncState(e instanceof CatalogueMismatchError ? "mismatch" : "offline")
          );
      }, 1500);
    },
    [lessonSlug, lessonVersion, catalogHash]
  );

  const retryProgress = useCallback(() => {
    if (retrying.current) return;
    retrying.current = true;
    retryLessonOutbox(
      { lessonSlug, lessonVersion, catalogHash, blockIds, checkpointSlug: "", questions: [] },
      (event) => {
        if (event.entry.kind !== "progress") return;
        if (event.kind === "progress-synced") setSyncState("idle");
        if (event.kind === "retry-paused") setSyncState(event.reason);
        if (event.kind === "incompatible") setSyncState("incompatible");
      }
    ).finally(() => {
      retrying.current = false;
    });
  }, [lessonSlug, lessonVersion, catalogHash, blockIds]);

  useEffect(() => {
    retryProgress();
    window.addEventListener("online", retryProgress);
    return () => window.removeEventListener("online", retryProgress);
  }, [retryProgress]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = blockIds.indexOf(entry.target.id.replace(/^block-/, ""));
          if (idx > furthest.current) {
            furthest.current = idx;
            push(blockIds[idx]);
          }
        }
      },
      { rootMargin: "0px 0px -40% 0px" }
    );
    for (const id of blockIds) {
      const el = document.getElementById(`block-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [blockIds, push]);

  return (
    <div style={{ margin: "6px 0 18px", minHeight: 18 }} aria-live="polite">
      {progressQ.isLoading && (
        <Note>Loading your progress…</Note>
      )}
      {!progressQ.isLoading && progressQ.error != null && (
        <Note>Progress is unavailable right now — the lesson is fully readable without it.</Note>
      )}
      {mine?.status === "completed" && (
        <Note tone="good">
          Completed{typeof mine.best_checkpoint_score === "number"
            ? ` · best checkpoint score ${Math.round(mine.best_checkpoint_score * 100)}%`
            : ""}
        </Note>
      )}
      {syncState === "mismatch" && (
        <Note tone="warn">
          Your reading position is saved on this device — syncing is paused while the app and
          server versions differ.
        </Note>
      )}
      {syncState === "offline" && (
        <Note>Reading position saved on this device — the API can&apos;t be reached yet.</Note>
      )}
      {syncState === "storage" && (
        <Note tone="warn">
          Automatic local saving is unavailable in this browser, so your reading position could
          not be safely retained.
        </Note>
      )}
      {syncState === "incompatible" && (
        <Note tone="warn">
          A saved reading position no longer matches this lesson version. Review the lesson before
          continuing.
        </Note>
      )}
    </div>
  );
}

/* ---------------- checkpoint ---------------- */

function Checkpoint({
  lessonSlug,
  lessonVersion,
  catalogHash,
  checkpointSlug,
  passScore,
  questions,
}: RuntimeProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CheckpointResult | null>(null);
  const [state, setState] = useState<
    "idle" | "submitting" | "mismatch" | "error" | "storage" | "changed" | "invalid"
  >("idle");
  const retrying = useRef(false);
  const complete = useMemo(
    () => questions.every((q) => answers[q.id] !== undefined),
    [questions, answers]
  );

  const retryCheckpoint = useCallback(() => {
    if (retrying.current) return;
    retrying.current = true;
    retryLessonOutbox(
      { lessonSlug, lessonVersion, catalogHash, blockIds: [], checkpointSlug, questions },
      (event) => {
        if (event.entry.kind !== "checkpoint") return;
        if (event.kind === "checkpoint-synced") {
          setResult(event.result);
          setState("idle");
        }
        if (event.kind === "retry-paused") {
          setState((s) => (s === "idle" ? (event.reason === "mismatch" ? "mismatch" : "error") : s));
        }
        if (event.kind === "incompatible") {
          setState(event.reason === "lesson-version-changed" ? "changed" : "invalid");
        }
      }
    ).finally(() => {
      retrying.current = false;
    });
  }, [lessonSlug, lessonVersion, catalogHash, checkpointSlug, questions]);

  useEffect(() => {
    retryCheckpoint();
    window.addEventListener("online", retryCheckpoint);
    return () => window.removeEventListener("online", retryCheckpoint);
  }, [retryCheckpoint]);

  async function submit() {
    const attempt = {
      lessonSlug,
      lessonVersion,
      checkpointSlug,
      catalogHash,
      responses: answers,
      clientAttemptId: newAttemptId(),
    };
    setState("submitting");
    const saved = savePendingCheckpoint(attempt);
    if (!saved.ok) {
      setState("storage");
      return;
    }
    try {
      const r = await postCheckpointAttempt(attempt);
      clearPendingOperation(saved.entry.id);
      setResult(r);
      setState("idle");
    } catch (e) {
      setState(e instanceof CatalogueMismatchError ? "mismatch" : "error");
    }
  }

  return (
    <section
      aria-label="Checkpoint"
      style={{
        marginTop: 34,
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        boxShadow: "var(--shadow)",
        padding: "20px 22px",
      }}
    >
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em" }}>
        CHECKPOINT · PASS AT {Math.round(passScore * 100)}%
      </div>
      {questions.map((q, qi) => {
        const graded = result?.per_question?.[q.id];
        return (
          <fieldset key={q.id} style={{ border: "none", margin: "16px 0 0", padding: 0 }}>
            <legend style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
              {qi + 1}. {q.prompt}
            </legend>
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "baseline",
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: result ? "default" : "pointer",
                  background:
                    graded && graded.answer === oi
                      ? graded.correct
                        ? "var(--good-bg)"
                        : "rgba(207,77,111,.10)"
                      : answers[q.id] === oi
                      ? "var(--sidebar-item)"
                      : "transparent",
                }}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={answers[q.id] === oi}
                  disabled={!!result}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                />
                <span>{opt}</span>
              </label>
            ))}
            {graded && (
              <div
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  marginTop: 4,
                  color: graded.correct ? "var(--good)" : "var(--bad)",
                }}
              >
                {graded.correct ? "correct" : "incorrect"}
              </div>
            )}
          </fieldset>
        );
      })}

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {!result && (
          <button
            className="fm-action-button"
            onClick={submit}
            disabled={!complete || state === "submitting"}
            style={{
              border: "none",
              font: "inherit",
              appearance: "none",
              cursor: complete ? "pointer" : "not-allowed",
              opacity: complete ? 1 : 0.5,
              padding: "9px 16px",
              borderRadius: 9,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {state === "submitting" ? "Checking…" : "Check my understanding"}
          </button>
        )}
        {result && (
          <strong
            role="status"
            style={{ fontSize: 13.5, color: result.passed ? "var(--good)" : "var(--bad)" }}
          >
            {result.passed ? "Passed" : "Not yet"} · {Math.round(result.score * 100)}%
            {result.duplicate ? " (previously recorded)" : ""}
          </strong>
        )}
        {result && !result.passed && (
          <button
            className="fm-action-button"
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
            style={{
              border: "none",
              font: "inherit",
              appearance: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--accent-ink)",
              textDecoration: "underline",
            }}
          >
            Re-read and try again
          </button>
        )}
      </div>

      {state === "mismatch" && (
        <Note tone="warn">
          Your answers are saved on this device — submission is paused while the app and server
          versions differ. They&apos;ll be submitted automatically when versions align.
        </Note>
      )}
      {state === "error" && (
        <Note>
          Couldn&apos;t reach the API — your answers are saved on this device and will be
          resubmitted when you reopen this lesson.
        </Note>
      )}
      {state === "storage" && (
        <Note tone="warn">
          Automatic local saving is unavailable in this browser, so your checkpoint answers were
          not submitted. Enable storage or try from another browser before retaking.
        </Note>
      )}
      {state === "changed" && (
        <Note tone="warn">
          This lesson changed since those answers were saved. Review the updated lesson and retake
          the checkpoint; the saved answers were not submitted.
        </Note>
      )}
      {state === "invalid" && (
        <Note tone="warn">
          Saved checkpoint answers no longer match this lesson&apos;s questions, so they were not
          submitted automatically.
        </Note>
      )}
    </section>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: tone === "good" ? "var(--good)" : tone === "warn" ? "var(--accent-ink)" : "var(--t3)",
        background: tone === "warn" ? "var(--accent-bg)" : "transparent",
        borderRadius: 8,
        padding: tone === "warn" ? "8px 10px" : 0,
        marginTop: 8,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
