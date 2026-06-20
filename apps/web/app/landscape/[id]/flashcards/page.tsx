"use client";

import { useEffect, useState } from "react";
import { apiGet, Flashcard } from "../../../../lib/api";

export default function FlashcardsPage({ params }: { params: { id: string } }) {
  const [items, setItems] = useState<Flashcard[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Flashcard[]>(`/api/landscapes/${params.id}/flashcards`)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="text-sm text-neutral-500">Loading…</div>;
  if (items.length === 0)
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Flashcards</h1>
        <p className="text-sm text-neutral-600">No flashcards yet for this landscape.</p>
      </div>
    );

  const cur = items[idx];

  function nextCard() {
    setIdx((n) => (n + 1) % items.length);
    setFlipped(false);
  }
  function prevCard() {
    setIdx((n) => (n - 1 + items.length) % items.length);
    setFlipped(false);
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between text-xs text-neutral-500 mb-3">
        <span>
          Card {idx + 1} of {items.length}
        </span>
        <span>{cur.kind}</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") setFlipped((f) => !f);
          if (e.key === "ArrowRight") nextCard();
          if (e.key === "ArrowLeft") prevCard();
        }}
        className="bg-white border border-neutral-200 rounded-lg p-6 min-h-[260px] flex items-center justify-center text-center cursor-pointer select-none shadow-sm"
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
            {flipped ? "Back" : "Front"}
          </div>
          <div className="text-lg leading-relaxed">{flipped ? cur.back : cur.front}</div>
          {!flipped && (
            <div className="text-xs text-neutral-400 mt-4">tap / space to flip</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={prevCard}
          className="border border-neutral-300 px-3 py-2 rounded-md"
        >
          ← Prev
        </button>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="bg-ink text-white px-4 py-2 rounded-md"
        >
          {flipped ? "Hide answer" : "Show answer"}
        </button>
        <button
          onClick={nextCard}
          className="border border-neutral-300 px-3 py-2 rounded-md"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
