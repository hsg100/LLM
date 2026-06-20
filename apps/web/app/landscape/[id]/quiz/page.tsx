"use client";

import { useEffect, useState } from "react";
import { apiGet, Quiz } from "../../../../lib/api";

export default function QuizPage({ params }: { params: { id: string } }) {
  const [items, setItems] = useState<Quiz[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Quiz[]>(`/api/landscapes/${params.id}/quiz`)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="text-sm text-neutral-500">Loading…</div>;
  if (items.length === 0)
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Quiz</h1>
        <p className="text-sm text-neutral-600">No quiz items yet for this landscape.</p>
      </div>
    );

  const cur = items[idx];
  const done = idx >= items.length;

  if (done) {
    return (
      <div className="max-w-xl mx-auto text-center">
        <h1 className="text-2xl font-semibold mb-2">Quiz complete</h1>
        <p className="text-lg mb-4">
          You got <span className="font-semibold">{score.correct}</span> / {score.total} correct.
        </p>
        <button
          onClick={() => {
            setIdx(0);
            setScore({ correct: 0, total: 0 });
            setPicked(null);
            setRevealed(false);
          }}
          className="bg-ink text-white px-4 py-2 rounded-md"
        >
          Restart
        </button>
      </div>
    );
  }

  function answer(i: number) {
    if (revealed) return;
    setPicked(i);
    setRevealed(true);
    setScore((s) => ({
      correct: s.correct + (i === cur.correct_index ? 1 : 0),
      total: s.total + 1,
    }));
  }

  function next() {
    setIdx((n) => n + 1);
    setPicked(null);
    setRevealed(false);
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between text-xs text-neutral-500 mb-3">
        <span>
          Q{idx + 1} of {items.length}
        </span>
        <span>
          {score.correct}/{score.total} correct so far
        </span>
      </div>
      <div className="w-full h-1 bg-neutral-200 rounded mb-4 overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${(idx / items.length) * 100}%` }} />
      </div>

      <h2 className="text-lg font-medium mb-4">{cur.question}</h2>

      <ul className="space-y-2">
        {cur.options.map((opt, i) => {
          const isCorrect = revealed && i === cur.correct_index;
          const isWrong = revealed && i === picked && i !== cur.correct_index;
          return (
            <li key={i}>
              <button
                onClick={() => answer(i)}
                disabled={revealed}
                className={`w-full text-left border rounded-md px-3 py-2 ${
                  isCorrect
                    ? "border-emerald-500 bg-emerald-50"
                    : isWrong
                    ? "border-red-500 bg-red-50"
                    : "border-neutral-300 bg-white hover:bg-neutral-50"
                } ${revealed ? "" : "cursor-pointer"}`}
              >
                <span className="font-mono text-xs text-neutral-500 mr-2">
                  {String.fromCharCode(65 + i)}.
                </span>
                {opt}
              </button>
            </li>
          );
        })}
      </ul>

      {revealed && (
        <div className="mt-4 bg-neutral-50 border border-neutral-200 rounded-md p-3 text-sm">
          {cur.explanation || "(no explanation)"}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={next}
          disabled={!revealed}
          className="bg-ink text-white px-4 py-2 rounded-md disabled:opacity-50"
        >
          {idx + 1 === items.length ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
