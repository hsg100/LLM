"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet, Landscape } from "../../lib/api";

/**
 * Review — product-level entry to retrieval practice (Phase 1 foundation).
 *
 * The cross-topic FSRS queue arrives with the curriculum (recovery plan
 * Phase 5). Today, review material lives inside each research landscape, so
 * this hub routes to those existing screens using real data only — no
 * fabricated due-counts or progress. Empty, loading and failure states are
 * explicit.
 */
export default function ReviewHubPage() {
  const { data, isLoading, error, refetch } = useQuery<Landscape[]>({
    queryKey: ["landscapes", "review-hub"],
    queryFn: () => apiGet<Landscape[]>("/api/landscapes"),
    retry: 1,
  });

  const ready = (data ?? []).filter((l) => l.status === "ready" || l.status === "done");

  return (
    <div
      className="fm-page"
      style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 7px" }}>
        Review
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 20px", maxWidth: 640 }}>
        Spaced retrieval practice with FSRS scheduling. Review lives inside each research landscape
        today; a single cross-topic queue ships with the curriculum.
      </p>

      {isLoading && (
        <div
          role="status"
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            padding: "22px",
            color: "var(--t3)",
            fontSize: 13,
          }}
        >
          Loading your landscapes…
        </div>
      )}

      {!isLoading && error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "12px 16px",
          }}
        >
          Couldn&apos;t reach the API — review material can&apos;t be listed right now.{" "}
          <button
            onClick={() => refetch()}
            style={{
              all: "unset",
              cursor: "pointer",
              fontWeight: 600,
              textDecoration: "underline",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && ready.length === 0 && (
        <div
          style={{
            border: "1px dashed var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            padding: "26px",
            textAlign: "center",
            color: "var(--t3)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          Nothing to review yet. Review items are generated when a research landscape finishes
          building.{" "}
          <Link href="/search" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
            Build your first landscape →
          </Link>
        </div>
      )}

      {!isLoading && !error && ready.length > 0 && (
        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          {ready.map((l, i) => (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px",
                borderBottom: i === ready.length - 1 ? "none" : "1px solid var(--bd2)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.topic}
                </div>
                <div className="font-mono" style={{ fontSize: 11, color: "var(--t4)", marginTop: 2 }}>
                  research landscape
                </div>
              </div>
              <Link
                href={`/landscape/${l.id}/review`}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "7px 13px",
                  borderRadius: 8,
                  border: "1px solid var(--bd)",
                  background: "var(--raised)",
                  fontSize: 12,
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
      )}
    </div>
  );
}
