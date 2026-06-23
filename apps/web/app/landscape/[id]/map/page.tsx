"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiGet, getLandscapeGraph, Landscape, LandscapePaper, PaperGraph } from "../../../../lib/api";
import {
  CATEGORY_META,
  Category,
  clusterDisplayColor,
  clusterLabel,
  hexAlpha,
} from "../../../../lib/clusters";
import RelationshipGraph, { relationshipGroupLabel } from "../../../../components/graph/RelationshipGraph";

type ClusterGroup = {
  id: string;
  name: string;
  summary: string;
  color: string;
  papers: LandscapePaper[];
  avgScore: number;
  ordinal: number;
};

type Mode = "learning" | "relationships";

export default function MapPage({ params }: { params: { id: string } }) {
  const [papers, setPapers] = useState<LandscapePaper[]>([]);
  const [synthesis, setSynthesis] = useState<any>({});
  const [graph, setGraph] = useState<PaperGraph | null>(null);
  const [mode, setMode] = useState<Mode>("learning");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    Promise.all([
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`, undefined, 10000),
      apiGet<Landscape>(`/api/landscapes/${params.id}`, undefined, 10000).catch(() => null),
      getLandscapeGraph(params.id).catch(() => null),
    ])
      .then(([p, l, g]) => {
        if (cancelled) return;
        setPapers(p);
        setSynthesis(l?.synthesis ?? {});
        setGraph(g);
      })
      .catch((e: any) => !cancelled && setErr(e.message || "Failed to load field map"));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const groups = useMemo<ClusterGroup[]>(() => {
    const byCluster: Record<string, LandscapePaper[]> = {};
    for (const p of papers) {
      const k = p.cluster_id || "unclustered";
      (byCluster[k] ||= []).push(p);
    }
    return Object.entries(byCluster)
      .map(([id, items]) => {
        const sorted = [...items].sort((a, b) => b.score - a.score);
        const first = sorted[0];
        const avgScore =
          sorted.reduce((sum, item) => sum + Number(item.score || 0), 0) / Math.max(1, sorted.length);
        return {
          id,
          name: id === "unclustered" ? "Unclustered papers" : clusterLabel(first),
          summary: first?.cluster_summary || "",
          color: first ? clusterDisplayColor(first) : "var(--t4)",
          papers: sorted,
          avgScore,
          ordinal: first?.cluster_ordinal ?? 999,
        };
      })
      .sort((a, b) => a.ordinal - b.ordinal || b.avgScore - a.avgScore || b.papers.length - a.papers.length);
  }, [papers]);

  const topPapers = useMemo(
    () => [...papers].sort((a, b) => b.score - a.score).slice(0, 6),
    [papers]
  );
  const relationshipCount = graph?.edges.length ?? 0;
  const relationshipGroups = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of graph?.edges ?? []) {
      const label = relationshipGroupLabel(edge.type);
      counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [graph]);

  return (
    <div className="fm-page" style={{ maxWidth: 1240, margin: "0 auto", padding: "30px 40px 72px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: 0, margin: "0 0 7px" }}>
            Field map
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", margin: 0, lineHeight: 1.55, maxWidth: 680 }}>
            Use the clusters as your reading lanes, then inspect relationships to see how papers build, compare, and evaluate each other.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, border: "1px solid var(--bd)", borderRadius: 9, padding: 3, background: "var(--panel)" }}>
            {(["learning", "relationships"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "6px 12px",
                  borderRadius: 7,
                  color: mode === m ? "#fff" : "var(--t3)",
                  background: mode === m ? "var(--accent)" : "transparent",
                }}
              >
                {m === "learning" ? "Learning path" : "Relationships"}
              </button>
            ))}
          </div>
          <div
            className="font-mono"
            style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--t3)", flexWrap: "wrap" }}
          >
            <span>{groups.length} clusters</span>
            <span>{papers.length} papers</span>
            <span>{relationshipCount} relationships</span>
          </div>
        </div>
      </div>

      {err && (
        <div
          style={{
            fontSize: 12,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 18,
          }}
        >
          {err}
        </div>
      )}

      {mode === "relationships" ? (
        graph ? (
          <RelationshipGraph nodes={graph.nodes} edges={graph.edges} landscapeId={params.id} />
        ) : (
          <EmptyPanel text="Relationship graph is still loading." />
        )
      ) : groups.length === 0 ? (
        <EmptyPanel text="No clusters yet for this landscape." />
      ) : (
        <div className="fm-map-layout" style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 18 }}>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(285px, 1fr))",
              gap: 14,
              alignItems: "start",
            }}
          >
            {groups.map((group, groupIndex) => (
              <ClusterLane key={group.id} group={group} index={groupIndex} />
            ))}
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Panel title="Field snapshot">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {groups.map((g) => (
                  <div key={g.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: "var(--t2)" }}>{g.name}</span>
                      <span className="font-mono" style={{ fontSize: 10, color: "var(--t4)" }}>
                        {Math.round(g.avgScore * 100)}
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: "var(--raised)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(8, Math.round(g.avgScore * 100))}%`,
                          background: g.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Relationship evidence">
              {relationshipCount === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.45 }}>
                  No paper-to-paper relationships were generated yet. The cluster lanes still provide the reading structure.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {relationshipGroups.map(([label, count]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{label}</span>
                      <span className="font-mono" style={{ fontSize: 11, color: "var(--t4)" }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Highest signal">
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {topPapers.map((p, i) => (
                  <Link
                    key={p.paper.id}
                    href={`/paper/${p.paper.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr",
                      gap: 9,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    <span className="font-mono" style={{ color: clusterDisplayColor(p), fontSize: 11 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.35 }}>
                      {shortTitle(p.paper.title, 70)}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

function ClusterLane({ group, index }: { group: ClusterGroup; index: number }) {
  return (
    <article
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        background: "var(--panel)",
        overflow: "hidden",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          padding: "15px 16px",
          borderBottom: "1px solid var(--bd)",
          background: hexAlpha(group.color, 0.1),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
          <span className="font-mono" style={{ color: group.color, fontSize: 11 }}>
            C{index + 1}
          </span>
          <h2 style={{ flex: 1, fontSize: 14, fontWeight: 650, letterSpacing: 0, margin: 0 }}>
            {group.name}
          </h2>
          <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>
            {group.papers.length}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--t3)", lineHeight: 1.45, margin: 0 }}>
          {group.summary || "A generated reading lane for papers with similar methods, questions, or evidence."}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {group.papers.slice(0, 8).map((p) => {
          const category = CATEGORY_META[(p.category as Category) ?? "optional"] ?? CATEGORY_META.optional;
          return (
            <Link
              key={p.paper.id}
              href={`/paper/${p.paper.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "42px 1fr",
                gap: 10,
                padding: "12px 15px",
                borderTop: "1px solid var(--bd2)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                className="font-mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 28,
                  borderRadius: 6,
                  background: hexAlpha(group.color, 0.12),
                  color: group.color,
                  fontSize: 11,
                }}
              >
                {Math.round(p.score * 100)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: "var(--t1)" }}>
                  {shortTitle(p.paper.title, 95)}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 7,
                    fontSize: 11,
                    color: "var(--t3)",
                  }}
                >
                  <span style={{ color: category.color }}>{category.label}</span>
                  <span>{p.paper.year ?? "year n/a"}</span>
                  {p.rationale && <span>{shortTitle(p.rationale, 70)}</span>}
                </div>
              </div>
            </Link>
          );
        })}
        {group.papers.length > 8 && (
          <div style={{ padding: "10px 15px 13px", fontSize: 11.5, color: "var(--t4)" }}>
            +{group.papers.length - 8} more in this lane
          </div>
        )}
      </div>
    </article>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        background: "var(--panel)",
        padding: "16px 17px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", marginBottom: 12, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div
      style={{
        border: "1px dashed var(--bd)",
        borderRadius: 8,
        background: "var(--panel)",
        padding: "22px 24px",
        color: "var(--t3)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

function shortTitle(title: string | null | undefined, n: number): string {
  const s = title || "Untitled";
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}
