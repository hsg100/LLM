"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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

// SVG view-box width. The wrapper SVG scales to its container; this is the
// internal coordinate system the layout maths use, not pixels on screen.
const W = 920;
const ROW_H = 118;
// Below this measured container width, we switch to the cluster roll-up view
// (one tappable node per cluster) and surface a `← All clusters` drill-out.
const ROLLUP_BREAKPOINT = 480;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const TAP_THRESHOLD_PX = 6;

export function relationshipMeta(type: string): RelationMeta {
  return REL[type] || REL.related;
}

export function relationshipGroupLabel(type: string): string {
  const group = relationshipMeta(type).group;
  return FILTERS.find((f) => f.id === group)?.label || "Related";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ResizeObserver-backed width measurement. We only need width — the SVG keeps
// its own viewBox and scales freely, so height re-flow comes for free.
function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === "number") setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
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
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  const [graphRef, containerWidth] = useElementSize<HTMLDivElement>();
  const tier: "rollup" | "papers" =
    containerWidth > 0 && containerWidth < ROLLUP_BREAKPOINT ? "rollup" : "papers";
  // Roll-up has two states: the overview (one node per cluster) and the
  // drill-in (one cluster's per-paper subgraph). On wider screens we always
  // render the per-paper view.
  const viewMode: "rollup_overview" | "rollup_expanded" | "papers" =
    tier === "rollup"
      ? expandedClusterId
        ? "rollup_expanded"
        : "rollup_overview"
      : "papers";

  // Pan + zoom. Stored in SVG-viewBox units so the `<g transform>` is direct.
  const [pan, setPan] = useState({ tx: 0, ty: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  // Pointer tracking lives in refs so move/up callbacks don't trigger re-renders.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStart = useRef<
    | { tx: number; ty: number; sx: number; sy: number }
    | null
  >(null);
  const pinchStart = useRef<
    | { dist: number; k: number; cxSvg: number; cySvg: number; tx: number; ty: number }
    | null
  >(null);
  const moveAccumPx = useRef(0);

  // Reset pan/zoom and selection when the user changes density tier or drills
  // in/out — otherwise a zoomed-in pan from one view bleeds into the next.
  useEffect(() => {
    setPan({ tx: 0, ty: 0, k: 1 });
    setSelectedEdgeKey(null);
    setSelectedPaperId(null);
  }, [viewMode]);

  const byId = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    for (const n of nodes) m[n.paper.id] = n;
    return m;
  }, [nodes]);

  const allClusters = useMemo(() => {
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

  // In rollup_expanded mode, the visible cluster set is just the one the user
  // tapped — that becomes a normal single-row per-paper layout.
  const displayedClusters = useMemo(() => {
    if (viewMode === "rollup_expanded" && expandedClusterId) {
      const one = allClusters.find((c) => c.id === expandedClusterId);
      return one ? [one] : allClusters;
    }
    return allClusters;
  }, [allClusters, viewMode, expandedClusterId]);

  // Per-paper layout: horizontal lanes, one per cluster.
  const paperLayout = useMemo(() => {
    const pos: Record<string, Pt> = {};
    displayedClusters.forEach((cluster, gi) => {
      const y = 74 + gi * ROW_H;
      const count = cluster.nodes.length;
      cluster.nodes.forEach((node, ni) => {
        const spread = W - 330;
        const x = count === 1 ? 500 : 255 + (spread * ni) / Math.max(1, count - 1);
        pos[node.paper.id] = { x, y };
      });
    });
    return pos;
  }, [displayedClusters]);

  // Rollup overview layout: 2-col grid of cluster nodes. Width and height are
  // expressed in the same viewBox-W units so the SVG continues to scale.
  const rollupLayout = useMemo(() => {
    const pos: Record<string, Pt> = {};
    const cols = 2;
    const cellW = W / cols;
    const cellH = 150;
    allClusters.forEach((cluster, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      pos[cluster.id] = {
        x: col * cellW + cellW / 2,
        y: 60 + row * cellH,
      };
    });
    return pos;
  }, [allClusters]);

  const rollupRows = Math.max(1, Math.ceil(allClusters.length / 2));
  const height =
    viewMode === "rollup_overview"
      ? Math.max(360, 60 + rollupRows * 150 + 40)
      : Math.max(420, 42 + displayedClusters.length * ROW_H);

  // Edge filtering applies to all tiers; the per-cluster select is only
  // meaningful in the papers view.
  const filteredEdges = useMemo(() => {
    return edges.filter((edge) => {
      const meta = relationshipMeta(edge.type);
      if (groupFilter !== "all" && meta.group !== groupFilter) return false;
      if (viewMode === "papers" && clusterFilter !== "all") {
        const src = byId[edge.source_paper_id];
        const dst = byId[edge.target_paper_id];
        if (src?.cluster_id !== clusterFilter && dst?.cluster_id !== clusterFilter) return false;
      }
      if (viewMode === "rollup_expanded" && expandedClusterId) {
        const src = byId[edge.source_paper_id];
        const dst = byId[edge.target_paper_id];
        const inCluster =
          src?.cluster_id === expandedClusterId || dst?.cluster_id === expandedClusterId;
        if (!inCluster) return false;
      }
      return true;
    });
  }, [edges, groupFilter, clusterFilter, byId, viewMode, expandedClusterId]);

  const selectedEdge = selectedPaperId
    ? null
    : filteredEdges.find((edge) => edgeKey(edge) === selectedEdgeKey) || filteredEdges[0] || null;
  const selectedPaper = selectedPaperId ? byId[selectedPaperId] : null;

  // ---- pointer handlers ----------------------------------------------------

  function clientToSvgPoint(clientX: number, clientY: number): Pt {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moveAccumPx.current = 0;
    if (pointers.current.size === 1) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY);
      dragStart.current = { tx: pan.tx, ty: pan.ty, sx: svgPt.x, sy: svgPt.y };
      pinchStart.current = null;
    } else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values()).slice(0, 2);
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
      const midSvg = clientToSvgPoint(
        (pts[0].x + pts[1].x) / 2,
        (pts[0].y + pts[1].y) / 2,
      );
      pinchStart.current = {
        dist,
        k: pan.k,
        cxSvg: midSvg.x,
        cySvg: midSvg.y,
        tx: pan.tx,
        ty: pan.ty,
      };
      dragStart.current = null;
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    moveAccumPx.current += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchStart.current && pointers.current.size >= 2) {
      const pts = Array.from(pointers.current.values()).slice(0, 2);
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
      const factor = dist / pinchStart.current.dist;
      const newK = clamp(pinchStart.current.k * factor, MIN_ZOOM, MAX_ZOOM);
      const { cxSvg, cySvg, tx, ty, k } = pinchStart.current;
      // Keep the original SVG-space midpoint anchored under the fingers.
      const worldX = (cxSvg - tx) / k;
      const worldY = (cySvg - ty) / k;
      setPan({ tx: cxSvg - worldX * newK, ty: cySvg - worldY * newK, k: newK });
      return;
    }

    if (dragStart.current && pointers.current.size === 1) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY);
      setPan({
        tx: dragStart.current.tx + (svgPt.x - dragStart.current.sx),
        ty: dragStart.current.ty + (svgPt.y - dragStart.current.sy),
        k: pan.k,
      });
    }
  }

  function onPointerEnd(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      dragStart.current = null;
      pinchStart.current = null;
    } else if (pointers.current.size === 1) {
      pinchStart.current = null;
      const remaining = Array.from(pointers.current.values())[0];
      const svgPt = clientToSvgPoint(remaining.x, remaining.y);
      dragStart.current = { tx: pan.tx, ty: pan.ty, sx: svgPt.x, sy: svgPt.y };
    }
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    // Only intercept zoom intent (Ctrl/Cmd or trackpad pinch which surfaces as
    // ctrlKey on most browsers). Plain wheel scrolls the page so the graph
    // doesn't trap vertical scrolling.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newK = clamp(pan.k * factor, MIN_ZOOM, MAX_ZOOM);
    const cursor = clientToSvgPoint(e.clientX, e.clientY);
    const worldX = (cursor.x - pan.tx) / pan.k;
    const worldY = (cursor.y - pan.ty) / pan.k;
    setPan({ tx: cursor.x - worldX * newK, ty: cursor.y - worldY * newK, k: newK });
  }

  function zoomBy(factor: number) {
    const newK = clamp(pan.k * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = W / 2;
    const cy = height / 2;
    const worldX = (cx - pan.tx) / pan.k;
    const worldY = (cy - pan.ty) / pan.k;
    setPan({ tx: cx - worldX * newK, ty: cy - worldY * newK, k: newK });
  }
  function resetView() {
    setPan({ tx: 0, ty: 0, k: 1 });
  }

  // ---- click guards --------------------------------------------------------
  // A tap is a click only if the pointer didn't travel far between down and up.
  // We gate the existing node/edge click handlers on this to keep drag silent.
  const isTap = () => moveAccumPx.current < TAP_THRESHOLD_PX;

  // ---- render --------------------------------------------------------------

  if (!nodes.length) {
    return (
      <div style={{ fontSize: 13, color: "var(--t3)", border: "1px dashed var(--bd)", borderRadius: 12, padding: 20, background: "var(--panel)" }}>
        No papers in this landscape yet.
      </div>
    );
  }

  const expandedClusterLabel = expandedClusterId
    ? allClusters.find((c) => c.id === expandedClusterId)?.label
    : null;

  return (
    <div
      className="fm-mobile-grid-one"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 330px", gap: 16, alignItems: "start" }}
    >
      <section ref={graphRef}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
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
          {tier === "papers" && (
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
              {allClusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
              ))}
            </select>
          )}
          <div style={{ marginLeft: tier === "papers" ? 0 : "auto", display: "flex", gap: 4 }}>
            <ZoomButton onClick={() => zoomBy(1.2)} title="Zoom in (+)" aria-label="Zoom in">+</ZoomButton>
            <ZoomButton onClick={() => zoomBy(1 / 1.2)} title="Zoom out (−)" aria-label="Zoom out">−</ZoomButton>
            <ZoomButton onClick={resetView} title="Reset view (0)" aria-label="Reset view">⌂</ZoomButton>
          </div>
        </div>

        {viewMode === "rollup_expanded" && expandedClusterLabel && (
          <button
            onClick={() => setExpandedClusterId(null)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--t2)",
              marginBottom: 8,
              padding: "6px 10px",
              border: "1px solid var(--bd)",
              borderRadius: 8,
              background: "var(--panel)",
            }}
          >
            ← All clusters · <span style={{ color: "var(--t1)", fontWeight: 600 }}>{expandedClusterLabel}</span>
          </button>
        )}

        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 10,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${height}`}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              touchAction: "none",
              userSelect: "none",
              cursor: pointers.current.size > 0 ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerLeave={onPointerEnd}
            onWheel={onWheel}
            onKeyDown={(e) => {
              if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.2); }
              else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.2); }
              else if (e.key === "0") { e.preventDefault(); resetView(); }
            }}
            tabIndex={0}
          >
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

            <g transform={`translate(${pan.tx} ${pan.ty}) scale(${pan.k})`}>
              {viewMode === "rollup_overview" ? (
                <RollupOverview
                  clusters={allClusters}
                  layout={rollupLayout}
                  onPick={(id) => isTap() && setExpandedClusterId(id)}
                />
              ) : (
                <>
                  {/* Cluster background bands — drawn first so they sit behind edges & nodes. */}
                  {displayedClusters.map((cluster, gi) => {
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
                    const src = paperLayout[edge.source_paper_id];
                    const dst = paperLayout[edge.target_paper_id];
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
                          if (!isTap()) return;
                          setSelectedPaperId(null);
                          setSelectedEdgeKey(key);
                        }}
                      />
                    );
                  })}

                  {displayedClusters.flatMap((c) => c.nodes).map((node) => {
                    const p = paperLayout[node.paper.id];
                    if (!p) return null;
                    const color = clusterDisplayColor(node);
                    const selected = selectedPaperId === node.paper.id;
                    const connected = selectedEdge
                      ? selectedEdge.source_paper_id === node.paper.id || selectedEdge.target_paper_id === node.paper.id
                      : false;
                    // Bump minimum radius and label legibility when the container
                    // is narrow so labels survive the viewBox shrink.
                    const baseR = containerWidth > 0 && containerWidth < 768 ? 12 : 8;
                    const radius = baseR + Math.min(8, node.score * 7);
                    const labelSize = containerWidth > 0 && containerWidth < 768 ? 13 : 11.5;
                    return (
                      <g
                        key={node.paper.id}
                        transform={`translate(${p.x},${p.y})`}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          if (!isTap()) return;
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
                        <text x={radius + 8} y="-2" fontSize={labelSize} fill="var(--t1)" fontWeight={selected || connected ? 650 : 500}>
                          {shortTitle(node.paper.title, 34)}
                        </text>
                        <text x={radius + 8} y="14" fontSize="9.5" fill="var(--t4)">
                          {Math.round(node.score * 100)} score
                        </text>
                      </g>
                    );
                  })}
                </>
              )}
            </g>
          </svg>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--t3)" }}>
          <span>{filteredEdges.length} visible relationship{filteredEdges.length === 1 ? "" : "s"}</span>
          {viewMode === "rollup_overview" ? (
            <span>Tap a cluster to drill in. Pinch to zoom.</span>
          ) : viewMode === "rollup_expanded" ? (
            <span>Tap a paper or edge for details below. Pinch to zoom.</span>
          ) : (
            <span>Click a line for evidence, or a paper for context. Ctrl + scroll to zoom.</span>
          )}
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

function ZoomButton({
  onClick,
  children,
  title,
  ...rest
}: {
  onClick: () => void;
  children: ReactNode;
  title: string;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        all: "unset",
        cursor: "pointer",
        width: 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        border: "1px solid var(--bd)",
        background: "var(--panel)",
        color: "var(--t2)",
        fontSize: 14,
        lineHeight: 1,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function RollupOverview({
  clusters,
  layout,
  onPick,
}: {
  clusters: { id: string; label: string; color: string; nodes: GraphNode[] }[];
  layout: Record<string, Pt>;
  onPick: (id: string) => void;
}) {
  return (
    <>
      {clusters.map((c) => {
        const p = layout[c.id];
        if (!p) return null;
        const r = 22 + Math.min(28, c.nodes.length * 3);
        return (
          <g
            key={c.id}
            transform={`translate(${p.x},${p.y})`}
            style={{ cursor: "pointer" }}
            onClick={() => onPick(c.id)}
          >
            <circle r={r + 6} fill={hexAlpha(c.color, 0.12)} />
            <circle r={r} fill={c.color} stroke="var(--panel)" strokeWidth="3" />
            <text
              y={r + 22}
              textAnchor="middle"
              fontSize="15"
              fontWeight="600"
              fill="var(--t1)"
            >
              {shortTitle(c.label, 26)}
            </text>
            <text
              y={r + 42}
              textAnchor="middle"
              fontSize="12"
              fill="var(--t4)"
            >
              {c.nodes.length} paper{c.nodes.length === 1 ? "" : "s"}
            </text>
          </g>
        );
      })}
    </>
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
