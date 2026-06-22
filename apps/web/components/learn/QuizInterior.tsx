"use client";

import { Quiz } from "../../lib/api";

// The interior of the quiz screen — rendered responsively on desktop and
// mobile. Stateless: the parent screen owns the question index, picked
// answer, etc.

export type QuizInteriorProps = {
  topic: string;
  total: number;
  idx: number;
  score: number;
  picked: number | null;
  revealed: boolean;
  finished: boolean;
  loading: boolean;
  current: Quiz | null;
  onAnswer: (i: number) => void;
  onNext: () => void;
  onRestart: () => void;
};

export function QuizInterior(props: QuizInteriorProps) {
  const {
    topic,
    total,
    idx,
    score,
    picked,
    revealed,
    finished,
    loading,
    current,
    onAnswer,
    onNext,
    onRestart,
  } = props;

  return (
    <>
      <div style={{ padding: "14px 20px 16px", borderBottom: "1px solid var(--bd)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {topic || "Landscape"} · Quiz
          </span>
          {!finished && total > 0 && (
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--t3)" }}
            >
              {idx + 1}/{total}
            </span>
          )}
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "var(--raised)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: total ? `${(idx / total) * 100}%` : "0%",
              background: "var(--accent)",
              transition: "width .3s",
            }}
          />
        </div>
      </div>

      {loading && (
        <div style={{ padding: 24, color: "var(--t3)", fontSize: 13 }}>
          Loading…
        </div>
      )}

      {!loading && total === 0 && (
        <div style={{ padding: 24, color: "var(--t3)", fontSize: 13 }}>
          No quiz items yet for this landscape.
        </div>
      )}

      {current && !finished && (
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {current.concept && (
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  color: "#5b8def",
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "rgba(91,141,239,.12)",
                }}
              >
                {current.concept}
              </span>
            )}
            <span
              className="font-mono"
              style={{ fontSize: 10, color: "var(--t3)" }}
            >
              level {current.difficulty}
            </span>
          </div>
          <div
            style={{
              fontSize: 16.5,
              fontWeight: 600,
              lineHeight: 1.4,
              marginBottom: 22,
              letterSpacing: "-0.01em",
            }}
          >
            {current.question}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {current.options.map((opt, oi) => {
              const isCorrect = oi === current.correct_index;
              const isSel = oi === picked;
              let bg = "var(--raised)";
              let bd = "var(--bd)";
              let fg = "var(--t2)";
              let mark = "";
              if (revealed) {
                if (isCorrect) {
                  bg = "var(--good-bg)";
                  bd = "var(--good)";
                  fg = "var(--t1)";
                  mark = "✓";
                } else if (isSel) {
                  bg = "rgba(207,77,111,.12)";
                  bd = "var(--bad)";
                  fg = "var(--t1)";
                  mark = "✕";
                } else {
                  fg = "var(--t4)";
                }
              }
              return (
                <button
                  key={oi}
                  onClick={() => onAnswer(oi)}
                  style={{
                    all: "unset",
                    cursor: revealed ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "14px 15px",
                    borderRadius: 12,
                    background: bg,
                    border: `1.5px solid ${bd}`,
                    color: fg,
                  }}
                >
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, flex: 1 }}>
                    {opt}
                  </span>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 14,
                      color: isCorrect ? "var(--good)" : "var(--bad)",
                    }}
                  >
                    {mark}
                  </span>
                </button>
              );
            })}
          </div>
          {revealed && current.explanation && (
            <div
              style={{
                marginTop: 18,
                border: "1px solid var(--bd)",
                borderRadius: 12,
                background: "var(--panel)",
                padding: "14px 15px",
                animation: "fm-fade .25s ease",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 10,
                  color: "var(--t3)",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                EXPLANATION
              </div>
              <div
                style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}
              >
                {current.explanation}
              </div>
            </div>
          )}
          {revealed && (
            <button
              onClick={onNext}
              style={{
                all: "unset",
                cursor: "pointer",
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                padding: 14,
                borderRadius: 12,
                background: "var(--accent)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {idx + 1 === total ? "See result" : "Next question"}
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                <path
                  d="M5 3l5 4.5L5 12"
                  stroke="#fff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      {finished && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 30,
            textAlign: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: 140,
              height: 140,
              marginBottom: 24,
            }}
          >
            <svg
              viewBox="0 0 120 120"
              style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}
            >
              <circle cx="60" cy="60" r="52" stroke="var(--raised)" strokeWidth="10" fill="none" />
              <circle
                cx="60"
                cy="60"
                r="52"
                stroke="var(--accent)"
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray="327"
                strokeDashoffset={Math.round(327 * (1 - score / Math.max(total, 1)))}
              />
            </svg>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                className="font-mono"
                style={{ fontSize: 34, fontWeight: 500 }}
              >
                {score}
                <span style={{ fontSize: 16, color: "var(--t4)" }}>/{total}</span>
              </span>
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            {Math.round((score / Math.max(total, 1)) * 100)}% correct
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--t3)",
              lineHeight: 1.5,
              marginBottom: 24,
            }}
          >
            {score / total >= 0.8
              ? "Strong — you've got the core loop down."
              : score / total >= 0.5
              ? "Solid start — review the misses."
              : "Worth another pass through Read-this-first."}
          </div>
          <button
            onClick={onRestart}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "12px 24px",
              borderRadius: 12,
              border: "1px solid var(--bd)",
              color: "var(--t1)",
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            Retake quiz
          </button>
        </div>
      )}
    </>
  );
}
