"use client";

// Dependency-free interactive relationship graph.
//
// Runs a small deterministic force simulation on mount, then renders an SVG with
// draggable nodes, wheel zoom, background pan, edge hover (type + rationale), and
// click-through to the paper. Kept self-contained so we don't pull a heavy graph
// library into the bundle.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../../lib/api";

type Pt = { x: number; y: number };

const EDGE_COLOR: Record<string, string> = {
  extends: "#2f9d6b",
  improves: "#2f9d6b",
  contradicts: "#cf4d6f",
  critiques: "#cf4d6f",
  applies: "#5b8def",
  benchmarks: "#8b6ae0",
  prerequisite: "#e0613a",
};

const CAT_COLOR: Record<string, string> = {
  "must-read": "#e0613a",
  useful: "#2f9d6b",
  optional: "#6a8cc0",
  "skip-for-now": "#8a867c",
};

const W = 760;
const H = 520;

function simulate(nodes: GraphNode[], edges: GraphEdge[]): Record<string, Pt> {
  const ids = nodes.map((n) => n.paper.id);
  const pos: Record<string, Pt> = {};
  // Deterministic seed: place on a circle by index.
  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, ids.length);
    pos[id] = { x: W / 2 + Math.cos(a) * 180, y: H / 2 + Math.sin(a) * 180 };
  });
  const adj = edges
    .filter((e) => pos[e.source_paper_id] && pos[e.target_paper_id])
    .map((e) => [e.source_paper_id, e.target_paper_id] as const);

  const K_REP = 5200; // repulsion
  const K_SPRING = 0.02; // attraction
  const REST = 120;
  for (let iter = 0; iter < 220; iter++) {
    const disp: Record<string, Pt> = {};
    for (const id of ids) disp[id] = { x: 0, y: 0 };
    // Repulsion between all pairs.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (i - j) || 1;
          dy = 1;
          d2 = 2;
        }
        const f = K_REP / d2;
        const d = Math.sqrt(d2);
        disp[ids[i]].x += (dx / d) * f;
        disp[ids[i]].y += (dy / d) * f;
        disp[ids[j]].x -= (dx / d) * f;
        disp[ids[j]].y -= (dy / d) * f;
      }
    }
    // Spring attraction along edges.
    for (const [s, t] of adj) {
      const a = pos[s];
      const b = pos[t];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = K_SPRING * (d - REST);
      disp[s].x += (dx / d) * f * 20;
      disp[s].y += (dy / d) * f * 20;
      disp[t].x -= (dx / d) * f * 20;
      disp[t].y -= (dy / d) * f * 20;
    }
    const cool = 1 - iter / 260;
    for (const id of ids) {
      // Pull gently toward center to keep things on-canvas.
      disp[id].x += (W / 2 - pos[id].x) * 0.01;
      disp[id].y += (H / 2 - pos[id].y) * 0.01;
      const dx = disp[id].x;
      const dy = disp[id].y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = Math.min(len, 24) * cool;
      pos[id].x += (dx / len) * step;
      pos[id].y += (dy / len) * step;
    }
  }
  return pos;
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
  const router = useRouter();
  const initial = useMemo(() => simulate(nodes, edges), [nodes, edges]);
  const [pos, setPos] = useState<Record<string, Pt>>(initial);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const drag = useRef<{ id: string | null; panning: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => setPos(initial), [initial]);

  const byId = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    for (const n of nodes) m[n.paper.id] = n;
    return m;
  }, [nodes]);

  if (!nodes.length) {
    return (
      <div style={{ fontSize: 13, color: "var(--t3)", border: "1px dashed var(--bd)", borderRadius: 12, padding: "20px", background: "var(--panel)" }}>
        No papers in this landscape yet.
      </div>
    );
  }

  function toLocal(e: React.MouseEvent): Pt {
    const rect = (e.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top) * (H / rect.height);
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  }

  function onNodeDown(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const p = toLocal(e);
    drag.current = { id, panning: false, sx: p.x, sy: p.y, ox: pos[id].x, oy: pos[id].y };
  }
  function onBgDown(e: React.MouseEvent) {
    drag.current = { id: null, panning: true, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  }
  function onMove(e: React.MouseEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.panning) {
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    } else if (d.id) {
      const p = toLocal(e);
      setPos((prev) => ({ ...prev, [d.id!]: { x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) } }));
    }
  }
  function onUp() {
    drag.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(2.5, v.scale * factor)) }));
  }

  const hovered = hoverEdge != null ? edges[hoverEdge] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", border: "1px solid var(--bd)", borderRadius: 14, background: "var(--panel)", cursor: drag.current?.panning ? "grabbing" : "grab", touchAction: "none" }}
        onMouseDown={onBgDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
          {edges.map((e, i) => {
            const a = pos[e.source_paper_id];
            const b = pos[e.target_paper_id];
            if (!a || !b) return null;
            const active = hoverEdge === i || hoverNode === e.source_paper_id || hoverNode === e.target_paper_id;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={EDGE_COLOR[e.type] || "var(--t4)"}
                strokeWidth={active ? 2.4 : 1.1}
                strokeOpacity={active ? 0.95 : 0.4}
                onMouseEnter={() => setHoverEdge(i)}
                onMouseLeave={() => setHoverEdge(null)}
              />
            );
          })}
          {nodes.map((n) => {
            const p = pos[n.paper.id];
            if (!p) return null;
            const r = 7 + Math.min(8, (n.score || 0) * 8);
            const color = CAT_COLOR[n.category] || "#6a8cc0";
            const active = hoverNode === n.paper.id;
            return (
              <g key={n.paper.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: "pointer" }}
                onMouseDown={(e) => onNodeDown(n.paper.id, e)}
                onMouseEnter={() => setHoverNode(n.paper.id)}
                onMouseLeave={() => setHoverNode(null)}
                onClick={(e) => { e.stopPropagation(); if (!drag.current || drag.current.id === null) router.push(`/paper/${n.paper.id}`); }}
              >
                <circle r={r} fill={color} fillOpacity={active ? 1 : 0.85} stroke="var(--panel)" strokeWidth={1.5} />
                {active && (
                  <text x={r + 4} y={4} fontSize={11} fill="var(--t1)" style={{ pointerEvents: "none" }}>
                    {n.paper.title.slice(0, 48)}
                    {n.paper.title.length > 48 ? "…" : ""}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div style={{ position: "absolute", left: 12, bottom: 12, maxWidth: 360, background: "var(--panel)", border: "1px solid var(--bd)", borderRadius: 10, padding: "10px 12px", boxShadow: "var(--shadow)", fontSize: 12 }}>
          <span className="font-mono" style={{ color: EDGE_COLOR[hovered.type] || "var(--t3)", fontSize: 11 }}>
            {hovered.type}
          </span>
          <div style={{ color: "var(--t2)", marginTop: 4, lineHeight: 1.45 }}>
            <strong>{byId[hovered.source_paper_id]?.paper.title.slice(0, 40)}</strong>
            {" → "}
            <strong>{byId[hovered.target_paper_id]?.paper.title.slice(0, 40)}</strong>
            {hovered.rationale ? <div style={{ marginTop: 4, color: "var(--t3)" }}>{hovered.rationale}</div> : null}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--t3)" }}>
        <span>Drag nodes · scroll to zoom · drag canvas to pan · click a node to open the paper</span>
      </div>
    </div>
  );
}
