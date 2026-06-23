"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { GraphEdge, GraphNode } from "../../lib/api";
import { clusterDisplayColor, clusterLabel, hexAlpha } from "../../lib/clusters";

type Pt = { x: number; y: number };
type RelationGroup = "all" | "builds" | "evaluation" | "contrast" | "survey" | "related";

type RelationMeta = {
  label: string;
  group: Exclude<RelationGroup, "all">;
  color: string;
  description: string;
};

const REL: Record<string, RelationMeta> = {
  extends: {
    label: "Builds on",
    group: "builds",
    color: "#2f9d6b",
    description: "One paper extends the method, framing, or result of another.",
  },
  improves: {
    label: "Improves",
    group: "builds",
    color: "#2f9d6b",
    description: "One paper claims a stronger method or result than another.",
  },
  baseline_for: {
    label: "Baseline for",
    group: "builds",
    color: "#5b8def",
    description: "The source paper is used as a comparison point for the target.",
  },
  uses_same_benchmark: {
    label: "Shared benchmark",
    group: "evaluation",
    color: "#8b6ae0",
    description: "Both papers evaluate against the same benchmark or task.",
  },
  introduces_dataset: {
    label: "Introduces dataset",
    group: "evaluation",
    color: "#8b6ae0",
    description: "The source paper introduces a dataset used by the target.",
  },
  introduces_metric: {
    label: "Introduces metric",
    group: "evaluation",
    color: "#8b6ae0",
    description: "The source paper introduces a metric used by the target.",
  },
  contradicts: {
    label: "Contrasts",
    group: "contrast",
    color: "#cf4d6f",
    description: "The papers make conflicting claims or report tension.",
  },
  critiques: {
    label: "Critiques",
    group: "contrast",
    color: "#cf4d6f",
    description: "The source paper critiques assumptions, methods, or limits of the target.",
  },
  survey_of: {
    label: "Surveys",
    group: "survey",
    color: "#d6a23a",
    description: "The source paper is a survey or review connected to the target.",
  },
  related: {
    label: "Related",
    group: "related",
    color: "#8a867c",
    description: "The papers are adjacent in topic, cluster, or extracted evidence.",
  },
};

const FILTERS: { id: RelationGroup; label: string }[] = [
  { id: "all", label: "All" },
  { id: "builds", label: "Builds on" },
  { id: "evaluation", label: "Evaluation" },
  { id: "contrast", label: "Contrast" },
  { id: "survey", label: "Survey" },
  { id: "related", label: "Related" },
];

const W = 920;
const ROW_H = 118;

export function relationshipMeta(type: string): RelationMeta {
  return REL[type] || REL.related;
}

export function relationshipGroupLabel(type: string): string {
  const group = relationshipMeta(type).group;
  return FILTERS.find((f) => f.id === group)?.label || "Related";
}

export default function RelationshipGraph({
  nodes,
  edges,
  landscapeId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  landscapeId: string;
}) {
  const [groupFilter, setGroupFilter] = useState<RelationGroup>("all");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    for (const n of nodes) m[n.paper.id] = n;
    return m;
  }, [nodes]);

  const clusters = useMemo(() => {
    const byCluster: Record<string, GraphNode[]> = {};
    for (const node of nodes) {
      const key = node.cluster_id || "unclustered";
      (byCluster[key] ||= []).push(node);
    }
    return Object.entries(byCluster)
      .map(([id, items]) => {
        const sorted = [...items].sort((a, b) => b.score - a.score);
        const first = sorted[0];
        return {
          id,
          label: id === "unclustered" ? "Unclustered papers" : clusterLabel(first),
          color: first ? clusterDisplayColor(first) : "var(--t4)",
          ordinal: first?.cluster_ordinal ?? 999,
          nodes: sorted,
        };
      })
      .sort((a, b) => a.ordinal - b.ordinal || a.label.localeCompare(b.label));
  }, [nodes]);

  const layout = useMemo(() => {
    const pos: Record<string, Pt> = {};
    clusters.forEach((cluster, gi) => {
      const y = 74 + gi * ROW_H;
      const count = cluster.nodes.length;
      cluster.nodes.forEach((node, ni) => {
        const spread = W - 330;
        const x = count === 1 ? 500 : 255 + (spread * ni) / Math.max(1, count - 1);
        pos[node.paper.id] = { x, y };
      });
    });
    return pos;
  }, [clusters]);

  const filteredEdges = useMemo(() => {
    return edges.filter((edge) => {
      const meta = relationshipMeta(edge.type);
      if (groupFilter !== "all" && meta.group !== groupFilter) return false;
      if (clusterFilter !== "all") {
        const src = byId[edge.source_paper_id];
        const dst = byId[edge.target_paper_id];
        if (src?.cluster_id !== clusterFilter && dst?.cluster_id !== clusterFilter) return false;
      }
      return true;
    });
  }, [edges, groupFilter, clusterFilter, byId]);

  const selectedEdge = selectedPaperId
    ? null
    : filteredEdges.find((edge) => edgeKey(edge) === selectedEdgeKey) || filteredEdges[0] || null;
  const selectedPaper = selectedPaperId ? byId[selectedPaperId] : null;
  const height = Math.max(420, 42 + clusters.length * ROW_H);

  if (!nodes.length) {
    return (
      <div style={{ fontSize: 13, color: "var(--t3)", border: "1px dashed var(--bd)", borderRadius: 12, padding: 20, background: "var(--panel)" }}>
        No papers in this landscape yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 330px", gap: 16, alignItems: "start" }}>
      <section>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              onClick={() => {
                setGroupFilter(filter.id);
                setSelectedEdgeKey(null);
                setSelectedPaperId(null);
              }}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "7px 11px",
                borderRadius: 8,
                border: "1px solid var(--bd)",
                background: groupFilter === filter.id ? "var(--accent)" : "var(--panel)",
                color: groupFilter === filter.id ? "#fff" : "var(--t2)",
                fontSize: 12,
              }}
            >
              {filter.label}
            </button>
          ))}
          <select
            value={clusterFilter}
            onChange={(e) => {
              setClusterFilter(e.target.value);
              setSelectedEdgeKey(null);
              setSelectedPaperId(null);
            }}
            style={{
              marginLeft: "auto",
              minWidth: 190,
              border: "1px solid var(--bd)",
              borderRadius: 8,
              background: "var(--panel)",
              color: "var(--t2)",
              padding: "7px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All clusters</option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
            ))}
          </select>
        </div>

        <div style={{ border: "1px solid var(--bd)", borderRadius: 10, background: "var(--panel)", overflow: "hidden", boxShadow: "var(--shadow)" }}>
          <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
            <defs>
              {Object.entries(REL).map(([type, meta]) => (
                <marker
                  key={type}
                  id={`arrow-${type}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={meta.color} />
                </marker>
              ))}
            </defs>

            {clusters.map((cluster, gi) => {
              const y = 24 + gi * ROW_H;
              return (
                <g key={cluster.id}>
                  <rect x="14" y={y} width={W - 28} height={ROW_H - 18} rx="10" fill={hexAlpha(cluster.color, 0.08)} />
                  <circle cx="34" cy={y + 26} r="5" fill={cluster.color} />
                  <text x="48" y={y + 30} fontSize="13" fill="var(--t1)" fontWeight="600">
                    {cluster.label}
                  </text>
                  <text x="48" y={y + 50} fontSize="10.5" fill="var(--t4)">
                    {cluster.nodes.length} paper{cluster.nodes.length === 1 ? "" : "s"}
                  </text>
                </g>
              );
            })}

            {filteredEdges.map((edge) => {
              const src = layout[edge.source_paper_id];
              const dst = layout[edge.target_paper_id];
              if (!src || !dst) return null;
              const meta = relationshipMeta(edge.type);
              const key = edgeKey(edge);
              const active = selectedEdge ? key === edgeKey(selectedEdge) : false;
              const midY = (src.y + dst.y) / 2;
              const curve = src.y === dst.y ? 36 : Math.max(42, Math.abs(src.y - dst.y) * 0.36);
              const d = src.y === dst.y
                ? `M ${src.x} ${src.y} C ${src.x + curve} ${src.y - 28}, ${dst.x - curve} ${dst.y - 28}, ${dst.x} ${dst.y}`
                : `M ${src.x} ${src.y} C ${src.x + curve} ${midY}, ${dst.x - curve} ${midY}, ${dst.x} ${dst.y}`;
              return (
                <path
                  key={key}
                  d={d}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={active ? 2.6 : 1.5}
                  strokeOpacity={active ? 0.95 : 0.42}
                  markerEnd={`url(#arrow-${edge.type in REL ? edge.type : "related"})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setSelectedPaperId(null);
                    setSelectedEdgeKey(key);
                  }}
                />
              );
            })}

            {nodes.map((node) => {
              const p = layout[node.paper.id];
              if (!p) return null;
              const color = clusterDisplayColor(node);
              const selected = selectedPaperId === node.paper.id;
              const connected = selectedEdge
                ? selectedEdge.source_paper_id === node.paper.id || selectedEdge.target_paper_id === node.paper.id
                : false;
              const radius = 8 + Math.min(8, node.score * 7);
              return (
                <g
                  key={node.paper.id}
                  transform={`translate(${p.x},${p.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setSelectedPaperId(node.paper.id);
                    setSelectedEdgeKey(null);
                  }}
                >
                  <circle
                    r={radius + (selected || connected ? 3 : 0)}
                    fill={selected ? "var(--accent)" : color}
                    fillOpacity={selected || connected ? 1 : 0.86}
                    stroke="var(--panel)"
                    strokeWidth="2"
                  />
                  <text x={radius + 8} y="-2" fontSize="11.5" fill="var(--t1)" fontWeight={selected || connected ? 650 : 500}>
                    {shortTitle(node.paper.title, 34)}
                  </text>
                  <text x={radius + 8} y="14" fontSize="9.5" fill="var(--t4)">
                    {Math.round(node.score * 100)} score
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--t3)" }}>
          <span>{filteredEdges.length} visible relationship{filteredEdges.length === 1 ? "" : "s"}</span>
          <span>Click a line for evidence, or a paper for context.</span>
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Inspector
          selectedPaper={selectedPaper}
          selectedEdge={selectedPaper ? null : selectedEdge}
          byId={byId}
          landscapeId={landscapeId}
        />

        <div style={{ border: "1px solid var(--bd)", borderRadius: 10, background: "var(--panel)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div className="font-mono" style={{ padding: "12px 13px", borderBottom: "1px solid var(--bd)", fontSize: 10, color: "var(--t4)", textTransform: "uppercase" }}>
            Relationship list
          </div>
          {filteredEdges.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12.5, color: "var(--t3)", lineHeight: 1.45 }}>
              No relationships match the current filters.
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {filteredEdges.map((edge) => {
                const meta = relationshipMeta(edge.type);
                const src = byId[edge.source_paper_id];
                const dst = byId[edge.target_paper_id];
                const active = selectedEdge ? edgeKey(edge) === edgeKey(selectedEdge) : false;
                return (
                  <button
                    key={edgeKey(edge)}
                    onClick={() => {
                      setSelectedPaperId(null);
                      setSelectedEdgeKey(edgeKey(edge));
                    }}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "12px 13px",
                      borderBottom: "1px solid var(--bd2)",
                      background: active ? hexAlpha(meta.color, 0.1) : "transparent",
                    }}
                  >
                    <div className="font-mono" style={{ color: meta.color, fontSize: 10, textTransform: "uppercase", marginBottom: 6 }}>
                      {meta.label}
                    </div>
                    <div style={{ fontSize: 12.3, lineHeight: 1.35, color: "var(--t2)" }}>
                      {shortTitle(src?.paper.title, 46)} -&gt; {shortTitle(dst?.paper.title, 46)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Inspector({
  selectedPaper,
  selectedEdge,
  byId,
  landscapeId,
}: {
  selectedPaper: GraphNode | null;
  selectedEdge: GraphEdge | null;
  byId: Record<string, GraphNode>;
  landscapeId: string;
}) {
  if (selectedPaper) {
    return (
      <Panel title="Selected paper">
        <div style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35, marginBottom: 8 }}>
          {selectedPaper.paper.title}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 11.5, color: "var(--t3)" }}>
          <span>{clusterLabel(selectedPaper)}</span>
          <span>{selectedPaper.paper.year ?? "year n/a"}</span>
          <span>{Math.round(selectedPaper.score * 100)} score</span>
        </div>
        <Link href={`/paper/${selectedPaper.paper.id}`} style={{ fontSize: 12.5, color: "var(--accent-ink)", fontWeight: 600 }}>
          Open paper
        </Link>
      </Panel>
    );
  }

  if (!selectedEdge) {
    return (
      <Panel title="Relationship evidence">
        <div style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.45 }}>
          No relationships are available yet. Use the learning lanes to start reading, then rerun with richer extractions for more graph evidence.
        </div>
      </Panel>
    );
  }

  const meta = relationshipMeta(selectedEdge.type);
  const src = byId[selectedEdge.source_paper_id];
  const dst = byId[selectedEdge.target_paper_id];
  return (
    <Panel title="Relationship evidence">
      <div className="font-mono" style={{ color: meta.color, fontSize: 11, textTransform: "uppercase", marginBottom: 8 }}>
        {meta.label}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.45, marginBottom: 12 }}>
        {meta.description}
      </div>
      <PaperLink label="Source" node={src} />
      <div style={{ height: 1, background: "var(--bd2)", margin: "12px 0" }} />
      <PaperLink label="Target" node={dst} />
      {selectedEdge.rationale && (
        <div style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--bd2)", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.5 }}>
          {selectedEdge.rationale}
        </div>
      )}
      <Link href={`/landscape/${landscapeId}/papers`} style={{ display: "inline-block", marginTop: 13, fontSize: 12.5, color: "var(--accent-ink)", fontWeight: 600 }}>
        Compare in ranked list
      </Link>
    </Panel>
  );
}

function PaperLink({ label, node }: { label: string; node?: GraphNode }) {
  if (!node) {
    return <div style={{ fontSize: 12.5, color: "var(--t4)" }}>{label}: missing paper</div>;
  }
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", marginBottom: 4 }}>
        {label}
      </div>
      <Link href={`/paper/${node.paper.id}`} style={{ color: "var(--t1)", fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
        {node.paper.title}
      </Link>
      <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--t3)" }}>
        {clusterLabel(node)} · {node.paper.year ?? "year n/a"}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--bd)", borderRadius: 10, background: "var(--panel)", boxShadow: "var(--shadow)", padding: 15 }}>
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", marginBottom: 12, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.source_paper_id}:${edge.target_paper_id}:${edge.type}`;
}

function shortTitle(title: string | null | undefined, n = 60): string {
  const s = title || "Untitled";
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}
