"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet, LandscapePaper, uploadPaper } from "../../../../lib/api";
import {
  CATEGORY_META,
  Category,
  categoryBg,
  clusterDisplayColor,
  clusterLabel,
  confidenceColor,
} from "../../../../lib/clusters";

type SortKey = "score" | "year" | "cites";

export default function PapersPage({ params }: { params: { id: string } }) {
  const [papers, setPapers] = useState<LandscapePaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function reloadPapers() {
    try {
      const p = await apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`);
      setPapers(p);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const r = await uploadPaper(params.id, file);
      setUploadMsg(
        `Added “${r.title}”` + (r.parsed ? ` · ${r.sections} sections` : " · parse failed")
      );
      await reloadPapers();
    } catch (err: any) {
      setUploadMsg(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`)
      .then((p) => {
        if (cancelled) return;
        setPapers(p);
      })
      .catch((e) => !cancelled && setErr(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: LandscapePaper, b: LandscapePaper) => number> = {
      score: (a, b) => b.score - a.score,
      year: (a, b) => (b.paper.year ?? 0) - (a.paper.year ?? 0),
      cites: (a, b) => (b.paper.citation_count ?? 0) - (a.paper.citation_count ?? 0),
    };
    return [...papers].sort(cmp[sortBy]);
  }, [papers, sortBy]);

  return (
    <div
      className="fm-page"
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "32px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 7px",
            }}
          >
            Ranked papers
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", margin: 0 }}>
            Composite score blends semantic relevance, recency, citations and
            survey signal, then MMR for diversity.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--bd)",
              background: "var(--panel)",
              color: "var(--t2)",
              cursor: uploading ? "default" : "pointer",
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? "Uploading…" : "Upload PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={onUpload}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
          {uploadMsg && (
            <span style={{ fontSize: 11.5, color: "var(--t3)", maxWidth: 240 }}>{uploadMsg}</span>
          )}
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: "var(--t4)",
              letterSpacing: "0.1em",
              marginRight: 2,
            }}
          >
            SORT
          </span>
          <SortChip
            label="Score"
            active={sortBy === "score"}
            onClick={() => setSortBy("score")}
          />
          <SortChip
            label="Year"
            active={sortBy === "year"}
            onClick={() => setSortBy("year")}
          />
          <SortChip
            label="Citations"
            active={sortBy === "cites"}
            onClick={() => setSortBy("cites")}
          />
        </div>
      </div>

      {err && (
        <div
          style={{
            fontSize: 13,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
          }}
        >
          {err}
        </div>
      )}

      {!err && !loading && papers.length === 0 && (
        <div
          style={{
            fontSize: 13,
            color: "var(--t3)",
            background: "var(--panel)",
            border: "1px solid var(--bd)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          No papers yet — the landscape job may still be running, or returned zero
          candidates.
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 13, color: "var(--t3)" }}>Loading…</div>
      )}

      {sorted.length > 0 && (
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
            className="font-mono fm-paper-table-head"
            style={{
              display: "grid",
              gridTemplateColumns: "48px 1fr 160px 132px 78px 100px",
              gap: 14,
              padding: "11px 18px",
              borderBottom: "1px solid var(--bd)",
              fontSize: 10,
              color: "var(--t4)",
              letterSpacing: "0.08em",
            }}
          >
            <div>RANK</div>
            <div>PAPER</div>
            <div>CLUSTER</div>
            <div>SCORE</div>
            <div>CONF</div>
            <div style={{ textAlign: "right" }}>YR · CITES</div>
          </div>
          {sorted.map((p, i) => {
            const cat = (p.category as Category) ?? "optional";
            const meta = CATEGORY_META[cat] ?? CATEGORY_META.optional;
            const clColor = clusterDisplayColor(p);
            const clName = p.cluster_id ? clusterLabel(p) : "—";
            const scorePct = Math.round(p.score * 100);
            return (
              <Link
                key={p.paper.id}
                href={`/paper/${p.paper.id}`}
                className="fm-paper-row"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "grid",
                  gridTemplateColumns: "48px 1fr 160px 132px 78px 100px",
                  gap: 14,
                  alignItems: "center",
                  padding: "15px 18px",
                  borderBottom: "1px solid var(--bd2)",
                }}
              >
                <div className="fm-paper-rank" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 4,
                      height: 32,
                      borderRadius: 2,
                      background: meta.color,
                    }}
                  />
                  <span
                    className="font-mono"
                    style={{ fontSize: 13, color: "var(--t3)" }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="fm-paper-main-title"
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      marginBottom: 5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.paper.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                        color: meta.color,
                        background: categoryBg(cat),
                        fontWeight: 500,
                      }}
                    >
                      {meta.label}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--t3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.paper.authors[0]?.split(" ").pop() ?? "—"}
                      {p.rationale ? ` · ${p.rationale}` : ""}
                    </span>
                  </div>
                </div>
                <div className="fm-mobile-hide" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: clColor,
                      flex: "none",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--t2)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {clName}
                  </span>
                </div>
                <div className="fm-mobile-hide" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="font-mono" style={{ fontSize: 13 }}>
                    {scorePct}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      background: "var(--raised)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${scorePct}%`,
                        background: meta.color,
                      }}
                    />
                  </div>
                </div>
                <div className="fm-mobile-hide" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: confidenceColor(p.score),
                    }}
                  />
                  <span
                    className="font-mono"
                    style={{ fontSize: 12, color: "var(--t3)" }}
                  >
                    {scorePct}
                  </span>
                </div>
                <div
                  className="font-mono fm-mobile-hide"
                  style={{
                    textAlign: "right",
                    fontSize: 12,
                    color: "var(--t3)",
                  }}
                >
                  {p.paper.year ?? "—"} · {p.paper.citation_count ?? 0}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        fontSize: 12,
        padding: "7px 13px",
        borderRadius: 8,
        background: active ? "var(--accent-bg)" : "var(--raised)",
        color: active ? "var(--accent-ink)" : "var(--t2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--bd)"}`,
      }}
    >
      {label}
    </button>
  );
}
