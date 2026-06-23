"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet, getLandscapeGraph, Landscape, LandscapePaper, PaperGraph } from "../../../../lib/api";
import {
  CATEGORY_META,
  Category,
  clusterColor,
  hexAlpha,
} from "../../../../lib/clusters";
import RelationshipGraph from "../../../../components/graph/RelationshipGraph";

type ClusterGroup = {
  id: string;
  name: string;
  summary: string;
  color: string;
  papers: LandscapePaper[];
  avgScore: number;
};

export default function MapPage({ params }: { params: { id: string } }) {
  const [papers, setPapers] = useState<LandscapePaper[]>([]);
  const [synthesis, setSynthesis] = useState<any>({});
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"clusters" | "relationships">("clusters");
  const [graph, setGraph] = useState<PaperGraph | null>(null);

  useEffect(() => {
    if (mode !== "relationships" || graph) return;
    getLandscapeGraph(params.id)
      .then(setGraph)
      .catch((e: any) => setErr(e.message || "Failed to load relationship graph"));
  }, [mode, graph, params.id]);

  useEffect(() => {
    setErr(null);
    Promise.all([
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`, undefined, 10000),
      apiGet<Landscape>(`/api/landscapes/${params.id}`, undefined, 10000).catch(() => null),
    ])
      .then(([p, l]) => {
        setPapers(p);
        setSynthesis(l?.synthesis ?? {});
      })
      .catch((e: any) => setErr(e.message || "Failed to load cluster map"));
  }, [params.id]);

  const clusterMeta = useMemo<Record<string, { name: string; summary: string }>>(() => {
    const out: Record<string, { name: string; summary: string }> = {};
    const arr = Array.isArray(synthesis.clusters) ? synthesis.clusters : [];
    for (const c of arr) {
      const id = c.id || c.name;
      if (id) out[id] = { name: c.name || id, summary: c.summary || "" };
    }
    return out;
  }, [synthesis]);

  const groups = useMemo<ClusterGroup[]>(() => {
    const byCluster: Record<string, LandscapePaper[]> = {};
    for (const p of papers) {
      const k = p.cluster_id || "other";
      (byCluster[k] ||= []).push(p);
    }
    return Object.entries(byCluster)
      .map(([id, items]) => {
        const sorted = [...items].sort((a, b) => b.score - a.score);
        const avgScore =
          sorted.reduce((sum, item) => sum + Number(item.score || 0), 0) / Math.max(1, sorted.length);
        return {
          id,
          name: clusterMeta[id]?.name || (id === "other" ? "Unclustered papers" : id),
          summary: clusterMeta[id]?.summary || "",
          color: clusterColor(id),
          papers: sorted,
          avgScore,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore || b.papers.length - a.papers.length);
  }, [papers, clusterMeta]);

  const topPapers = useMemo(
    () => [...papers].sort((a, b) => b.score - a.score).slice(0, 6),
    [papers]
  );

  return (
    <div className="fm-page" style={{ maxWidth: 1220, margin: "0 auto", padding: "30px 40px 72px" }}>
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
            Cluster map
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", margin: 0, lineHeight: 1.55 }}>
            Clusters are ranked by average relevance. Open any paper to inspect the grounded notes.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, border: "1px solid var(--bd)", borderRadius: 9, padding: 3, background: "var(--panel)" }}>
            {(["clusters", "relationships"] as const).map((m) => (
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
                {m === "clusters" ? "Clusters" : "Relationships"}
              </button>
            ))}
          </div>
          <div
            className="font-mono"
            style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--t3)", flexWrap: "wrap" }}
          >
            <span>{groups.length} clusters</span>
            <span>{papers.length} papers</span>
            <span>{graph ? `${graph.edges.length} edges` : `${topPapers.length} highlighted`}</span>
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
        !graph ? (
          <div style={{ color: "var(--t3)", fontSize: 13, padding: "20px 0" }}>Loading graph…</div>
        ) : (
          <RelationshipGraph nodes={graph.nodes} edges={graph.edges} landscapeId={params.id} />
        )
      ) : groups.length === 0 ? (
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
          No clusters yet for this landscape.
        </div>
      ) : (
        <div className="fm-map-layout" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18 }}>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 14,
              alignItems: "start",
            }}
          >
            {groups.map((group, groupIndex) => (
              <ClusterLane
                key={group.id}
                group={group}
                index={groupIndex}
                landscapeId={params.id}
              />
            ))}
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                border: "1px solid var(--bd)",
                borderRadius: 8,
                background: "var(--panel)",
                padding: "16px 17px",
                boxShadow: "var(--shadow)",
              }}
            >
              <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", marginBottom: 12 }}>
                FIELD SNAPSHOT
              </div>
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
            </div>

            <div
              style={{
                border: "1px solid var(--bd)",
                borderRadius: 8,
                background: "var(--panel)",
                padding: "16px 17px",
                boxShadow: "var(--shadow)",
              }}
            >
              <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", marginBottom: 12 }}>
                HIGHEST SIGNAL
              </div>
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
                    <span className="font-mono" style={{ color: clusterColor(p.cluster_id), fontSize: 11 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.35 }}>
                      {shortTitle(p.paper.title, 70)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ClusterLane({
  group,
  index,
}: {
  group: ClusterGroup;
  index: number;
  landscapeId: string;
}) {
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
          padding: "14px 15px",
          borderBottom: "1px solid var(--bd)",
          background: hexAlpha(group.color, 0.1),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
          <span className="font-mono" style={{ color: group.color, fontSize: 11 }}>
            C{index + 1}
          </span>
          <h2 style={{ flex: 1, fontSize: 14, fontWeight: 600, letterSpacing: 0, margin: 0 }}>
            {group.name}
          </h2>
          <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>
            {group.papers.length}
          </span>
        </div>
        {group.summary && (
          <p style={{ fontSize: 12, color: "var(--t3)", lineHeight: 1.45, margin: 0 }}>
            {group.summary}
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {group.papers.slice(0, 8).map((p) => {
          const category = CATEGORY_META[(p.category as Category) ?? "optional"];
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
                  <span>{p.paper.year ?? "unknown year"}</span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: category?.color ?? "var(--t4)",
                    }}
                  />
                  <span>{category?.label ?? p.category}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </article>
  );
}

function shortTitle(title: string, max: number): string {
  const clean = (title || "Untitled paper").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}...`;
}
