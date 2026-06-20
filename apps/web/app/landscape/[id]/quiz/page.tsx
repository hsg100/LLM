"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, Landscape, Quiz } from "../../../../lib/api";
import { QuizInterior } from "../../../../components/learn/QuizInterior";

export default function QuizPage({ params }: { params: { id: string } }) {
  const [items, setItems] = useState<Quiz[]>([]);
  const [topic, setTopic] = useState<string>("");
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<Quiz[]>(`/api/landscapes/${params.id}/quiz`),
      apiGet<Landscape>(`/api/landscapes/${params.id}`).catch(() => null),
    ])
      .then(([qs, l]) => {
        setItems(qs);
        if (l) setTopic(l.topic);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const total = items.length;
  const finished = idx >= total && total > 0;
  const current = !finished ? items[idx] ?? null : null;

  function answer(i: number) {
    if (revealed || !current) return;
    setPicked(i);
    setRevealed(true);
    if (i === current.correct_index) setScore((s) => s + 1);
  }

  function next() {
    setIdx((n) => n + 1);
    setPicked(null);
    setRevealed(false);
  }

  function restart() {
    setIdx(0);
    setScore(0);
    setPicked(null);
    setRevealed(false);
  }

  const interior = (
    <QuizInterior
      topic={topic}
      total={total}
      idx={idx}
      score={score}
      picked={picked}
      revealed={revealed}
      finished={finished}
      loading={loading}
      current={current}
      onAnswer={answer}
      onNext={next}
      onRestart={restart}
    />
  );

  return (
    <>
      {/* =================== MOBILE: full-bleed =================== */}
      <div
        className="md:hidden fm-learn-mobile"
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          animation: "fm-fade .3s ease",
        }}
      >
        {interior}
        <LearnSwitch active="quiz" landscapeId={params.id} />
      </div>

      {/* =================== DESKTOP: side-by-side layout =================== */}
      <div
        className="hidden md:flex"
        style={{
          minHeight: "100%",
          gap: 40,
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "36px 40px 72px",
          flexWrap: "wrap",
          animation: "fm-fade .3s ease",
        }}
      >
        <div style={{ maxWidth: 300, paddingTop: 16 }}>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--accent-ink)",
              letterSpacing: "0.1em",
              marginBottom: 10,
            }}
          >
            ACTIVE RECALL
          </div>
          <h1
            style={{
              fontSize: 25,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 14px",
            }}
          >
            Quiz
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.65,
              color: "var(--t3)",
              margin: "0 0 22px",
            }}
          >
            One question at a time, generated from the extracted notes. Tap an
            answer to see grounded feedback.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { c: "var(--good)", t: "Immediate scoring & explanation" },
              { c: "#5b8def", t: "Each question links to its source paper" },
              { c: "var(--warn)", t: "Misses feed your weak-areas review" },
            ].map((it) => (
              <div key={it.t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: it.c,
                  }}
                />
                <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{it.t}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <Link
              href={`/landscape/${params.id}/flashcards`}
              style={{
                fontSize: 12,
                color: "var(--accent-ink)",
                textDecoration: "none",
              }}
            >
              Switch to flashcards →
            </Link>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            maxWidth: 520,
            minWidth: 320,
            border: "1px solid var(--bd)",
            borderRadius: 18,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          {interior}
        </div>
      </div>
    </>
  );
}

/** Small pill row above the bottom tab bar so mobile users can flip between
    the two Learn surfaces without leaving the screen. */
function LearnSwitch({
  active,
  landscapeId,
}: {
  active: "quiz" | "flashcards";
  landscapeId: string;
}) {
  return (
    <div
      className="fm-learn-switch"
      style={{
        display: "flex",
        gap: 6,
        padding: "10px 16px 14px",
        borderTop: "1px solid var(--bd2)",
        background: "var(--bg)",
      }}
    >
      <SwitchLink
        href={`/landscape/${landscapeId}/quiz`}
        label="Quiz"
        active={active === "quiz"}
      />
      <SwitchLink
        href={`/landscape/${landscapeId}/flashcards`}
        label="Flashcards"
        active={active === "flashcards"}
      />
    </div>
  );
}

function SwitchLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        flex: 1,
        textAlign: "center",
        padding: "8px 12px",
        borderRadius: 9,
        background: active ? "var(--accent-bg)" : "var(--raised)",
        color: active ? "var(--accent-ink)" : "var(--t2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--bd)"}`,
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
