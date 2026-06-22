"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getReviewQueue,
  getWeakAreas,
  submitReview,
  ReviewQueue,
  ReviewQueueItem,
  ReviewRating,
  WeakArea,
} from "../../../../lib/api";

type Tab = "review" | "weak";

const RATINGS: { rating: ReviewRating; label: string; color: string }[] = [
  { rating: 1, label: "Again", color: "var(--bad)" },
  { rating: 2, label: "Hard", color: "var(--warn)" },
  { rating: 3, label: "Good", color: "var(--good)" },
  { rating: 4, label: "Easy", color: "#5b8def" },
];

export default function ReviewPage({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState<Tab>("review");
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [weak, setWeak] = useState<WeakArea[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    getReviewQueue(params.id)
      .then((q) => {
        setQueue(q);
        setIdx(0);
        setDone(0);
        setRevealed(false);
        setPicked(null);
      })
      .catch((e) => setErr(e.message || String(e)));
    getWeakAreas(params.id)
      .then(setWeak)
      .catch(() => setWeak([]));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const items = queue?.items ?? [];
  const current: ReviewQueueItem | null = items[idx] ?? null;

  async function record(rating: ReviewRating, correct?: boolean) {
    if (!current || busy) return;
    setBusy(true);
    try {
      await submitReview(params.id, {
        item_kind: current.item_kind,
        item_id: current.item_id,
        rating,
        correct,
      });
      setDone((n) => n + 1);
      setRevealed(false);
      setPicked(null);
      setIdx((n) => n + 1);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function pickOption(i: number) {
    if (picked !== null) return;
    setPicked(i);
  }

  const remaining = items.length - idx;

  return (
    <div
      className="fm-page"
      style={{ maxWidth: 680, margin: "0 auto", padding: "26px 20px 96px", animation: "fm-fade .3s ease" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Review</h1>
        <Link href={`/landscape/${params.id}`} style={{ fontSize: 12, color: "var(--t3)" }}>
          ← Landscape
        </Link>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--bd)", marginBottom: 20 }}>
        <TabBtn label="Daily queue" active={tab === "review"} onClick={() => setTab("review")} />
        <TabBtn label={`Weak areas${weak.length ? ` (${weak.length})` : ""}`} active={tab === "weak"} onClick={() => setTab("weak")} />
      </div>

      {err && (
        <div style={{ fontSize: 13, color: "var(--bad)", background: "rgba(207,77,111,.1)", border: "1px solid var(--bad)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          {err}
        </div>
      )}

      {tab === "review" && (
        <>
          {queue && (
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--t4)", marginBottom: 16 }}>
              <span>Due: {queue.due_count}</span>
              <span>New: {queue.new_count}</span>
              <span>Reviewed: {done}</span>
            </div>
          )}

          {!queue ? (
            <div style={{ color: "var(--t3)", fontSize: 13 }}>Loading…</div>
          ) : !current ? (
            <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--bd)", borderRadius: 16, background: "var(--panel)" }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                {done > 0 ? "All caught up 🎉" : "Nothing due right now."}
              </div>
              <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 16 }}>
                {done > 0 ? `You reviewed ${done} item${done === 1 ? "" : "s"}.` : "New cards and due cards will appear here."}
              </div>
              <button onClick={load} style={btnStyle("var(--accent)")}>Refresh queue</button>
            </div>
          ) : current.flashcard ? (
            <FlashcardCard
              key={current.item_id}
              front={current.flashcard.front}
              back={current.flashcard.back}
              kind={current.flashcard.kind}
              state={current.state}
              remaining={remaining}
              revealed={revealed}
              busy={busy}
              onReveal={() => setRevealed(true)}
              onRate={(r) => record(r)}
            />
          ) : current.quiz ? (
            <QuizCard
              key={current.item_id}
              question={current.quiz.question}
              options={current.quiz.options}
              correctIndex={current.quiz.correct_index}
              explanation={current.quiz.explanation}
              state={current.state}
              remaining={remaining}
              picked={picked}
              busy={busy}
              onPick={(i) => pickOption(i)}
              onContinue={() => {
                const correct = picked === current.quiz!.correct_index;
                record(correct ? 3 : 1, correct);
              }}
            />
          ) : null}
        </>
      )}

      {tab === "weak" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {weak.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--t3)", border: "1px dashed var(--bd)", borderRadius: 12, padding: "18px 18px", background: "var(--panel)" }}>
              No attempts recorded yet — answer some cards to see weak areas.
            </div>
          ) : (
            weak.map((w) => {
              const pct = Math.round(w.accuracy * 100);
              const color = pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--warn)" : "var(--bad)";
              return (
                <div key={w.concept} style={{ border: "1px solid var(--bd)", borderRadius: 12, background: "var(--panel)", padding: "14px 16px", boxShadow: "var(--shadow)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{w.concept}</span>
                    <span className="font-mono" style={{ fontSize: 12, color }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--raised)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t4)", marginTop: 6 }}>
                    {w.correct}/{w.attempts} correct
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function FlashcardCard({
  front,
  back,
  kind,
  state,
  remaining,
  revealed,
  busy,
  onReveal,
  onRate,
}: {
  front: string;
  back: string;
  kind: string;
  state: string;
  remaining: number;
  revealed: boolean;
  busy: boolean;
  onReveal: () => void;
  onRate: (r: ReviewRating) => void;
}) {
  return (
    <div style={cardShell}>
      <CardMeta left={kind === "explain" ? "Explain-before-reveal" : kind} state={state} remaining={remaining} />
      <div style={{ fontSize: 17, lineHeight: 1.5, margin: "14px 0 18px" }}>{front}</div>
      {!revealed ? (
        <button onClick={onReveal} style={{ ...btnStyle("var(--accent)"), width: "100%" }}>
          Show answer
        </button>
      ) : (
        <>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--t2)", borderTop: "1px solid var(--bd2)", paddingTop: 14, marginBottom: 18 }}>
            {back}
          </div>
          <div style={{ fontSize: 11, color: "var(--t4)", marginBottom: 8 }}>How well did you recall it?</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {RATINGS.map((r) => (
              <button key={r.rating} disabled={busy} onClick={() => onRate(r.rating)} style={btnStyle(r.color)}>
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QuizCard({
  question,
  options,
  correctIndex,
  explanation,
  state,
  remaining,
  picked,
  busy,
  onPick,
  onContinue,
}: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  state: string;
  remaining: number;
  picked: number | null;
  busy: boolean;
  onPick: (i: number) => void;
  onContinue: () => void;
}) {
  return (
    <div style={cardShell}>
      <CardMeta left="Multiple choice" state={state} remaining={remaining} />
      <div style={{ fontSize: 16, lineHeight: 1.5, margin: "14px 0 16px" }}>{question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((opt, i) => {
          const isCorrect = i === correctIndex;
          const show = picked !== null;
          const bg = show && isCorrect ? "var(--good-bg)" : show && i === picked ? "rgba(207,77,111,.12)" : "var(--raised)";
          const bd = show && isCorrect ? "var(--good)" : show && i === picked ? "var(--bad)" : "var(--bd)";
          return (
            <button
              key={i}
              onClick={() => onPick(i)}
              disabled={picked !== null}
              style={{ all: "unset", cursor: picked === null ? "pointer" : "default", fontSize: 14, padding: "12px 14px", borderRadius: 10, background: bg, border: `1px solid ${bd}`, color: "var(--t1)" }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div style={{ marginTop: 16 }}>
          {explanation && (
            <div style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.55, marginBottom: 14 }}>{explanation}</div>
          )}
          <button disabled={busy} onClick={onContinue} style={{ ...btnStyle("var(--accent)"), width: "100%" }}>
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

function CardMeta({ left, state, remaining }: { left: string; state: string; remaining: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5 }}>
      <span className="font-mono" style={{ color: "var(--t4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{left}</span>
      <span style={{ color: "var(--t4)" }}>
        {state === "new" ? "new" : state} · {remaining} left
      </span>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ all: "unset", cursor: "pointer", fontSize: 13, padding: "10px 14px", color: active ? "var(--t1)" : "var(--t3)", boxShadow: `inset 0 -2px 0 ${active ? "var(--accent)" : "transparent"}` }}
    >
      {label}
    </button>
  );
}

const cardShell: React.CSSProperties = {
  border: "1px solid var(--bd)",
  borderRadius: 16,
  background: "var(--panel)",
  padding: "18px 20px 22px",
  boxShadow: "var(--shadow)",
};

function btnStyle(color: string): React.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    textAlign: "center",
    fontSize: 13,
    fontWeight: 600,
    padding: "11px 12px",
    borderRadius: 10,
    color: "#fff",
    background: color,
    boxSizing: "border-box",
  };
}
