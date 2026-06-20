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
        <LearnSwitch active="flashcards" landscapeId={params.id} />
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
            SPACED REVIEW
          </div>
          <h1
            style={{
              fontSize: 25,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 14px",
            }}
          >
            Flashcards
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.65,
              color: "var(--t3)",
              margin: "0 0 22px",
            }}
          >
            Tap the card to flip. Rate your recall — cards you miss come back
            sooner. Concepts pulled from every paper in the landscape.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 22,
            }}
          >
            <StatBox value={known} label="known" color="var(--good)" />
            <StatBox value={review} label="review" color="var(--warn)" />
          </div>
          <Link
            href={`/landscape/${params.id}/quiz`}
            style={{ fontSize: 12, color: "var(--accent-ink)", textDecoration: "none" }}
          >
            Switch to quiz →
          </Link>
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
        borderRadius: 12,
        background: "var(--panel)",
        padding: "14px 15px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div className="font-mono" style={{ fontSize: 22, color }}>
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
