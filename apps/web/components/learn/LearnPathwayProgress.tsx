"use client";

// Real learner progress over the pathway, layered onto the statically
// rendered curriculum map. Honest states only: loading, unavailable, empty
// and a real continue link — no fabricated progress.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getLearnProgress } from "../../lib/learn";

export function LearnPathwayProgress({
  catalogHash,
  lessonTopics,
}: {
  catalogHash: string;
  lessonTopics: Record<string, string>;
}) {
  const q = useQuery({ queryKey: ["learn-progress"], queryFn: getLearnProgress, retry: 1 });

  if (q.isLoading) {
    return <Quiet role="status">Loading your progress…</Quiet>;
  }
  if (q.error) {
    return (
      <Quiet role="alert">
        Progress is unavailable right now — every lesson below is still fully readable.
      </Quiet>
    );
  }
  const lessons = q.data?.lessons ?? [];
  if (lessons.length === 0) {
    return <Quiet>No lessons started yet — pick a topic below to begin.</Quiet>;
  }
  const completed = lessons.filter((l) => l.status === "completed").length;
  const inProgress = [...lessons]
    .filter((l) => l.status === "in_progress")
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  const stale = q.data && q.data.catalog_hash !== catalogHash;

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: "12px 16px",
        marginBottom: 26,
        fontSize: 13,
        color: "var(--t2)",
        display: "flex",
        gap: 14,
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
    >
      <strong>{completed} completed</strong>
      <span style={{ color: "var(--t4)" }}>·</span>
      <span>{lessons.length - completed} in progress</span>
      {inProgress && lessonTopics[inProgress.lesson_slug] && (
        <Link
          href={`/learn/${lessonTopics[inProgress.lesson_slug]}/${inProgress.lesson_slug}`}
          style={{ color: "var(--accent-ink)", fontWeight: 600 }}
        >
          Continue →
        </Link>
      )}
      {stale && (
        <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>
          server catalogue differs from this build — writes may pause until they align
        </span>
      )}
    </div>
  );
}

function Quiet({ children, role }: { children: React.ReactNode; role?: string }) {
  return (
    <div
      role={role}
      style={{
        border: "1px dashed var(--bd)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: "12px 16px",
        marginBottom: 26,
        fontSize: 12.5,
        color: "var(--t3)",
      }}
    >
      {children}
    </div>
  );
}
