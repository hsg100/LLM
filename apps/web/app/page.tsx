"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet, getReviewQueue, Landscape } from "../lib/api";

/**
 * Home — the learner dashboard foundation (recovery plan Phase 1).
 *
 * Answers three questions with real data only:
 *   1. Where am I in the LLM pathway?   → honest "in build" state; no fake progress.
 *   2. What should I do next?           → preview the pathway, or research a topic.
 *   3. What needs review?               → real FSRS due/new counts from existing landscapes.
 *
 * The page must not depend on a worker or model provider: every section
 * renders an explicit empty/loading/failure state when the API is unavailable.
 */

const REVIEW_SCAN_LIMIT = 6; // bound the per-landscape queue fan-out

type ReviewSummary = {
  landscape: Landscape;
  due: number;
  fresh: number;
};

export default function HomePage() {
  const landscapesQ = useQuery<Landscape[]>({
    queryKey: ["landscapes", "home"],
    queryFn: () => apiGet<Landscape[]>("/api/landscapes"),
    retry: 1,
  });

  const ready = (landscapesQ.data ?? []).filter((l) => l.status === "ready" || l.status === "done");
  const scan = ready.slice(0, REVIEW_SCAN_LIMIT);

  const reviewQ = useQuery<ReviewSummary[]>({
    queryKey: ["home-review-summary", scan.map((l) => l.id).join(",")],
    enabled: scan.length > 0,
    retry: 1,
    queryFn: async () => {
      const settled = await Promise.allSettled(
        scan.map(async (landscape) => {
          const q = await getReviewQueue(landscape.id, 1);
          return { landscape, due: q.due_count, fresh: q.new_count };
        })
      );
      return settled
        .filter((r): r is PromiseFulfilledResult<ReviewSummary> => r.status === "fulfilled")
        .map((r) => r.value);
    },
  });

  return (
    <div
      className="fm-page"
      style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}
    >
      {/* ---- Hero: the next action ---- */}
      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 16,
          background: "var(--panel)",
          boxShadow: "var(--shadow)",
          padding: "26px 26px 24px",
          marginBottom: 26,
        }}
      >
        <div
          className="font-mono"
          style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", marginBottom: 10 }}
        >
          START LEARNING
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 8px" }}>
          Understand LLMs from first principles to current research
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--t3)", margin: "0 0 18px", maxWidth: 620, lineHeight: 1.6 }}>
          FieldMap is becoming an interactive learning environment. The structured LLM pathway —
          interactive lessons, predictions and checkpoints — is in build; the research engine that
          powers it is live today.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/learn"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 17px",
              borderRadius: 9,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 2px 10px rgba(224,97,58,.28)",
            }}
          >
            Preview the LLM pathway →
          </Link>
          <Link
            href="/landscapes"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 17px",
              borderRadius: 9,
              border: "1px solid var(--bd)",
              background: "var(--raised)",
              color: "var(--t2)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Open Research
          </Link>
        </div>
      </div>

      {/* ---- Due for review (real data) ---- */}
      <SectionLabel>DUE FOR REVIEW</SectionLabel>
      <ReviewSection
        landscapesLoading={landscapesQ.isLoading}
        landscapesError={!!landscapesQ.error}
        readyCount={ready.length}
        scanCount={scan.length}
        summaries={reviewQ.data}
        summariesLoading={reviewQ.isLoading}
        summariesError={!!reviewQ.error}
      />

      {/* ---- Explore current research (real data) ---- */}
      <SectionLabel style={{ marginTop: 28 }}>EXPLORE CURRENT RESEARCH</SectionLabel>
      <ResearchSection
        loading={landscapesQ.isLoading}
        error={landscapesQ.error ? String((landscapesQ.error as Error).message || landscapesQ.error) : null}
        landscapes={landscapesQ.data ?? []}
        onRetry={() => landscapesQ.refetch()}
      />
    </div>
  );
}

function ReviewSection({
  landscapesLoading,
  landscapesError,
  readyCount,
  scanCount,
  summaries,
  summariesLoading,
  summariesError,
}: {
  landscapesLoading: boolean;
  landscapesError: boolean;
  readyCount: number;
  scanCount: number;
  summaries: ReviewSummary[] | undefined;
  summariesLoading: boolean;
  summariesError: boolean;
}) {
  if (landscapesLoading || (scanCount > 0 && summariesLoading)) {
    return <QuietCard role="status">Checking what&apos;s due…</QuietCard>;
  }
  if (landscapesError) {
    return (
      <QuietCard role="alert">
        Review status is unavailable — the API can&apos;t be reached right now.
      </QuietCard>
    );
  }
  if (readyCount === 0) {
    return (
      <QuietCard>
        Nothing to review yet — review items are generated when a research landscape finishes
        building.{" "}
        <Link href="/search" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          Build one →
        </Link>
      </QuietCard>
    );
  }
  if (summariesError || !summaries) {
    return (
      <QuietCard role="alert">
        Couldn&apos;t load review queues.{" "}
        <Link href="/review" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          Open Review →
        </Link>
      </QuietCard>
    );
  }

  const withWork = summaries.filter((s) => s.due + s.fresh > 0);
  const totalDue = summaries.reduce((n, s) => n + s.due, 0);
  const totalNew = summaries.reduce((n, s) => n + s.fresh, 0);

  if (withWork.length === 0) {
    return (
      <QuietCard>
        Nothing due right now
        {readyCount > scanCount ? ` in your ${scanCount} most recent landscapes` : ""}.{" "}
        <Link href="/review" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          See all review →
        </Link>
      </QuietCard>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderBottom: "1px solid var(--bd2)",
          fontSize: 12.5,
          color: "var(--t3)",
        }}
      >
        <strong style={{ color: "var(--t1)" }}>
          {totalDue} due · {totalNew} unseen
        </strong>
        <span style={{ flex: 1 }} />
        <Link href="/review" style={{ color: "var(--accent-ink)", fontWeight: 600, fontSize: 12 }}>
          All review →
        </Link>
      </div>
      {withWork.map((s, i) => (
        <div
          key={s.landscape.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 18px",
            borderBottom: i === withWork.length - 1 ? "none" : "1px solid var(--bd2)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.landscape.topic}
            </div>
            <div className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)", marginTop: 2 }}>
              {s.due} due · {s.fresh} unseen
            </div>
          </div>
          <Link
            href={`/landscape/${s.landscape.id}/review`}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--bd)",
              background: "var(--raised)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--t2)",
              whiteSpace: "nowrap",
            }}
          >
            Review →
          </Link>
        </div>
      ))}
    </div>
  );
}

function ResearchSection({
  loading,
  error,
  landscapes,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  landscapes: Landscape[];
  onRetry: () => void;
}) {
  if (loading) {
    return <QuietCard role="status">Loading landscapes…</QuietCard>;
  }
  if (error) {
    return (
      <QuietCard role="alert">
        Couldn&apos;t reach the API: <span className="font-mono">{error}</span>{" "}
        <button
          onClick={onRetry}
          style={{ all: "unset", cursor: "pointer", fontWeight: 600, textDecoration: "underline" }}
        >
          Retry
        </button>
      </QuietCard>
    );
  }
  if (landscapes.length === 0) {
    return (
      <QuietCard>
        No research landscapes yet. FieldMap maps any LLM topic into ranked papers, reading plans
        and study material.{" "}
        <Link href="/search" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          Build your first landscape →
        </Link>
      </QuietCard>
    );
  }

  const recent = landscapes.slice(0, 5);
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      {recent.map((l, i) => (
        <Link
          key={l.id}
          href={`/landscape/${l.id}`}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 18px",
            borderBottom: i === recent.length - 1 ? "none" : "1px solid var(--bd2)",
          }}
        >
          <span
            style={{
              flex: "none",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background:
                l.status === "ready" || l.status === "done"
                  ? "var(--good)"
                  : l.status === "failed"
                  ? "var(--bad)"
                  : "var(--accent)",
            }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {l.topic}
          </span>
          <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>
            {l.status}
          </span>
        </Link>
      ))}
      <div style={{ padding: "11px 18px", borderTop: "1px solid var(--bd2)", fontSize: 12 }}>
        <Link href="/landscapes" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          All landscapes →
        </Link>
        <span style={{ color: "var(--t4)", margin: "0 8px" }}>·</span>
        <Link href="/search" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          New landscape →
        </Link>
      </div>
    </div>
  );
}

function QuietCard({ children, role }: { children: React.ReactNode; role?: string }) {
  return (
    <div
      role={role}
      style={{
        border: "1px dashed var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "20px 22px",
        color: "var(--t3)",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="font-mono"
      style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", margin: "0 0 10px", ...style }}
    >
      {children}
    </div>
  );
}
