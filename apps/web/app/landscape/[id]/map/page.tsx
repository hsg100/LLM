"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet, Landscape, LandscapePaper } from "../../../../lib/api";
import {
  CATEGORY_META,
  Category,
  clusterColor,
} from "../../../../lib/clusters";

const W = 820;
const H = 540;

type Node = {
  id: string;
  title: string;
  paper: LandscapePaper;
  x: number;
  y: number;
  r: number;
  color: string;
  clusterId: string;
};

export default function MapPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [papers, setPapers] = useState<LandscapePaper[]>([]);
  const [synthesis, setSynthesis] = useState<any>({});
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`),
      apiGet<Landscape>(`/api/landscapes/${params.id}`).catch(() => null),
    ]).then(([p, l]) => {
      setPapers(p);
      setSynthesis(l?.synthesis ?? {});
    });
  }, [params.id]);

  const clusterNameById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const arr = Array.isArray(synthesis.clusters) ? synthesis.clusters : [];
    for (const c of arr) {
      const id = c.id || c.name;
      if (id) out[id] = c.name;
    }
    return out;
  }, [synthesis]);

  const { nodes, edges, legend } = useMemo(() => {
    const groups: Record<string, LandscapePaper[]> = {};
    for (const p of papers) {
      const k = p.cluster_id || "other";
      (groups[k] ||= []).push(p);
    }
    const keys = Object.keys(groups);
    const cx = W / 2;
    const cy = H / 2;
    const ringR = Math.min(W, H) * 0.36;
    const centers: Record<string, { x: number; y: number }> = {};
    keys.forEach((k, i) => {
      if (keys.length === 1) {
        centers[k] = { x: cx, y: cy };
      } else {
        const angle = (i / keys.length) * 2 * Math.PI - Math.PI / 2;
        centers[k] = { x: cx + Math.cos(angle) * ringR, y: cy + Math.sin(angle) * ringR };
      }
    });

    const nodes: Node[] = [];
    for (const k of keys) {
      const group = [...groups[k]].sort((a, b) => b.score - a.score);
      const center = centers[k];
      const baseR = 90;
      group.forEach((p, idx) => {
        const a = (idx / Math.max(group.length, 1)) * 2 * Math.PI;
        // Highest-scoring paper sits closer to the cluster centre.
        const radial = baseR * (0.35 + 0.65 * (idx / Math.max(group.length - 1, 1)));
        nodes.push({
          id: p.paper.id,
          title: p.paper.title.split(":")[0],
          paper: p,
          x: center.x + Math.cos(a) * radial,
          y: center.y + Math.sin(a) * radial,
          r: 9 + p.score * 13,
          color: clusterColor(p.cluster_id),
          clusterId: k,
        });
      });
    }

    // Edges: connect each paper to its nearest-by-score neighbour in the
    // same cluster — enough structure to read as a graph without doing per-
    // paper extraction fetches.
    type Edge = { a: string; b: string };
    const edges: Edge[] = [];
    for (const k of keys) {
      const group = [...groups[k]].sort((a, b) => b.score - a.score);
      for (let i = 0; i < group.length - 1; i++) {
        edges.push({ a: group[i].paper.id, b: group[i + 1].paper.id });
      }
      // Also wire the top-scored node of each cluster into a small inter-
      // cluster ring so the picture isn't a disconnected forest.
      if (keys.length > 1 && group.length) {
        const next = keys[(keys.indexOf(k) + 1) % keys.length];
        const nextGroup = [...groups[next]].sort((a, b) => b.score - a.score);
        if (nextGroup.length) {
          edges.push({ a: group[0].paper.id, b: nextGroup[0].paper.id });
        }
      }
    }

    const legend = keys.map((k) => ({
      id: k,
      name: clusterNameById[k] || k,
      color: clusterColor(k),
      count: groups[k].length,
    }));

    return { nodes, edges, legend };
  }, [papers, clusterNameById]);

  const byId = useMemo(() => {
    const m: Record<string, Node> = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  const hoverNode = hover ? byId[hover] : null;
  const neighbours = useMemo(() => {
    if (!hover) return new Set<string>();
    const out = new Set<string>();
    for (const e of edges) {
      if (e.a === hover) out.add(e.b);
      if (e.b === hover) out.add(e.a);
    }
    return out;
  }, [hover, edges]);

  const topNodes = useMemo(
    () => [...nodes].sort((a, b) => b.paper.score - a.paper.score).slice(0, 5),
    [nodes]
  );

  return (
    <>
      <div
        className="md:hidden fm-page"
        style={{
          animation: "fm-fade .3s ease",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 7px",
            }}
          >
            Cluster map
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.55, margin: 0 }}>
            Mobile shows a read-only cluster summary. Use desktop for the full graph.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 22 }}>
          {legend.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--t3)",
                border: "1px dashed var(--bd)",
                borderRadius: 12,
                padding: "16px 18px",
                background: "var(--panel)",
              }}
            >
              No clusters yet for this landscape.
            </div>
          ) : (
            legend.map((l) => (
              <div
                key={l.id}
                style={{
                  border: "1px solid var(--bd)",
                  borderRadius: 14,
                  background: "var(--panel)",
                  padding: "14px 15px",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: l.color,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
                    {l.name}
                  </span>
                  <span className="font-mono" style={{ fontSize: 11, color: "var(--t4)" }}>
                    {l.count} papers
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {topNodes.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--t3)",
                marginBottom: 9,
              }}
            >
              Highest-signal papers
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {topNodes.map((n, i) => (
                <Link
                  key={n.id}
                  href={`/paper/${n.id}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    border: "1px solid var(--bd)",
                    borderRadius: 14,
                    background: "var(--panel)",
                    padding: "13px 15px",
                    boxShadow: "var(--shadow)",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span className="font-mono" style={{ fontSize: 12, color: n.color }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>
                      {n.title}
                    </div>
                    <div
                      className="font-mono"
                      style={{ fontSize: 10.5, color: "var(--t4)", marginTop: 5 }}
                    >
                      score {Math.round(n.paper.score * 100)} ·{" "}
                      {clusterNameById[n.clusterId] || n.clusterId}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

    <div
      className="hidden md:flex"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        animation: "fm-fade .3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "26px 40px 16px",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 6px",
            }}
          >
            Cluster map
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", margin: 0 }}>
            Node size = relevance · edges link nearest neighbours · hover to trace.
          </p>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {legend.map((l) => (
            <div
              key={l.id}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: l.color,
                }}
              />
              <span style={{ fontSize: 11.5, color: "var(--t2)" }}>{l.name}</span>
              <span
                className="font-mono"
                style={{ fontSize: 10, color: "var(--t4)" }}
              >
                {l.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          position: "relative",
          margin: "0 40px 40px",
          border: "1px solid var(--bd)",
          borderRadius: 18,
          background: "var(--map-bg)",
          overflow: "hidden",
          minHeight: 480,
          boxShadow: "var(--shadow)",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {edges.map((e, i) => {
            const a = byId[e.a];
            const b = byId[e.b];
            if (!a || !b) return null;
            const incident = hover === e.a || hover === e.b;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={incident ? "var(--accent)" : "var(--map-edge)"}
                strokeOpacity={hover ? (incident ? 0.85 : 0.06) : 0.32}
                strokeWidth={incident ? 1.6 : 1}
              />
            );
          })}
          {nodes.map((n) => {
            const dim = hover && hover !== n.id && !neighbours.has(n.id) ? 0.25 : 1;
            return (
              <g
                key={n.id}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => router.push(`/paper/${n.id}`)}
                style={{ cursor: "pointer" }}
                opacity={dim}
              >
                <circle cx={n.x} cy={n.y} r={n.r + 9} fill={n.color} opacity={0.12} />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={n.color}
                  stroke="var(--node-stroke)"
                  strokeWidth={2}
                />
                <text
                  x={n.x}
                  y={n.y + n.r + 15}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="var(--t2)"
                  style={{ pointerEvents: "none" }}
                >
                  {n.title.slice(0, 32)}
                </text>
              </g>
            );
          })}
        </svg>

        {hoverNode && (
          <Link
            href={`/paper/${hoverNode.id}`}
            style={{
              all: "unset",
              cursor: "pointer",
              position: "absolute",
              left: 22,
              bottom: 22,
              width: 300,
              border: "1px solid var(--bd)",
              borderRadius: 14,
              background: "var(--panel)",
              padding: "17px 19px",
              boxShadow: "0 12px 40px rgba(0,0,0,.18)",
              animation: "fm-fade .15s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: hoverNode.color,
                }}
              />
              <span style={{ fontSize: 11, color: "var(--t3)" }}>
                {clusterNameById[hoverNode.clusterId] || hoverNode.clusterId}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  color: "#fff",
                  background:
                    CATEGORY_META[(hoverNode.paper.category as Category) ?? "optional"]
                      ?.color ?? "#8a867c",
                }}
              >
                {CATEGORY_META[(hoverNode.paper.category as Category) ?? "optional"]
                  ?.label ?? hoverNode.paper.category}
              </span>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.3,
                marginBottom: 6,
              }}
            >
              {hoverNode.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--t3)",
                marginBottom: 11,
              }}
            >
              {hoverNode.paper.rationale ?? hoverNode.paper.paper.abstract?.slice(0, 110)}
            </div>
            <div
              className="font-mono"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontSize: 11,
                color: "var(--t3)",
              }}
            >
              <span style={{ color: hoverNode.color }}>
                score {Math.round(hoverNode.paper.score * 100)}
              </span>
              <span>{hoverNode.paper.paper.year ?? "—"}</span>
              <span>{neighbours.size} links</span>
              <span style={{ marginLeft: "auto", color: "var(--accent-ink)" }}>open →</span>
            </div>
          </Link>
        )}

        {!hoverNode && (
          <div
            className="font-mono"
            style={{
              position: "absolute",
              right: 22,
              top: 22,
              fontSize: 10,
              color: "var(--t4)",
            }}
          >
            hover a node →
          </div>
        )}
      </div>
      </div>
    </>
  );
}
