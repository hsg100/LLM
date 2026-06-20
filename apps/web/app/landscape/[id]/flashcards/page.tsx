"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, Flashcard, Landscape } from "../../../../lib/api";
import { FlashcardInterior } from "../../../../components/learn/FlashcardInterior";

export default function FlashcardsPage({ params }: { params: { id: string } }) {
  const [items, setItems] = useState<Flashcard[]>([]);
  const [topic, setTopic] = useState<string>("");
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [review, setReview] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<Flashcard[]>(`/api/landscapes/${params.id}/flashcards`),
      apiGet<Landscape>(`/api/landscapes/${params.id}`).catch(() => null),
    ])
      .then(([cs, l]) => {
        setItems(cs);
        if (l) setTopic(l.topic);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const total = items.length;
  const current = items[idx] ?? null;

  function advance(asKnown: boolean) {
    if (asKnown) setKnown((n) => n + 1);
    else setReview((n) => n + 1);
    setIdx((n) => (n + 1) % Math.max(total, 1));
    setFlipped(false);
  }

  const interior = (
    <FlashcardInterior
      topic={topic}
      total={total}
      idx={idx}
      flipped={flipped}
      current={current}
      loading={loading}
      onFlip={() => setFlipped((f) => !f)}
      onAdvance={advance}
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
            Flashcards
          </h1>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--t3)",
              margin: 0,
            }}
          >
            Tap the card to flip, then rate your recall.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <StatBox value={known} label="known" color="var(--good)" />
          <StatBox value={review} label="review" color="var(--warn)" />
          <LearnSwitch active="flashcards" landscapeId={params.id} />
        </div>
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

function StatBox({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        background: "var(--panel)",
        padding: "8px 12px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div className="font-mono" style={{ fontSize: 16, color }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

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
