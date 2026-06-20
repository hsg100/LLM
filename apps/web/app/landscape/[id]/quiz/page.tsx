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
    <div
      className="fm-page"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "30px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: 0,
              margin: "0 0 7px",
            }}
          >
            Quiz
          </h1>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--t3)",
              margin: 0,
            }}
          >
            One question at a time, generated from the extracted notes.
          </p>
        </div>
        <LearnSwitch active="quiz" landscapeId={params.id} />
      </div>

      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 8,
          background: "var(--panel)",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
        }}
      >
        {interior}
      </div>
    </div>
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
      style={{
        display: "flex",
        gap: 6,
        padding: 0,
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
