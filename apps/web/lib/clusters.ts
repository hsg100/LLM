// Shared cluster + category palettes used everywhere the UI colour-codes
// papers or research areas. Mirrored from the design system.

export type ClusterKey =
  | "reason"
  | "tool"
  | "multi"
  | "memory"
  | "eval"
  | "other";

export const CLUSTER_META: Record<ClusterKey, { name: string; color: string }> = {
  reason: { name: "Reasoning & Planning", color: "#5b8def" },
  tool: { name: "Tool Use & Grounding", color: "#3fb98a" },
  multi: { name: "Multi-Agent Systems", color: "#9b7bf0" },
  memory: { name: "Memory & Reflection", color: "#d6a23a" },
  eval: { name: "Evaluation & Benchmarks", color: "#e06b8a" },
  other: { name: "Other", color: "#8a867c" },
};

// Cluster palette fallback for synthesised clusters whose ids we don't know.
export const CLUSTER_PALETTE = [
  "#5b8def",
  "#3fb98a",
  "#9b7bf0",
  "#d6a23a",
  "#e06b8a",
  "#2f9d9d",
  "#e0613a",
  "#8b6ae0",
];

export type Category = "must-read" | "useful" | "optional" | "skip-for-now";

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  "must-read": { label: "Must-read", color: "#e0613a" },
  useful: { label: "Useful", color: "#2f9d6b" },
  optional: { label: "Optional", color: "#6a8cc0" },
  "skip-for-now": { label: "Skip for now", color: "#8a867c" },
};

// Translate raw cluster id from backend into a deterministic colour.
// Synthesis clusters carry free-form ids — we just hash the id into the
// palette so the same id always picks the same colour across screens.
export function clusterColor(clusterId: string | null | undefined): string {
  if (!clusterId) return CLUSTER_META.other.color;
  const key = clusterId.toLowerCase();
  // try to match well-known semantic keys to the named palette
  if (key.includes("reason") || key.includes("plan")) return CLUSTER_META.reason.color;
  if (key.includes("tool") || key.includes("ground")) return CLUSTER_META.tool.color;
  if (key.includes("multi") || key.includes("agent")) return CLUSTER_META.multi.color;
  if (key.includes("memory") || key.includes("reflect")) return CLUSTER_META.memory.color;
  if (key.includes("eval") || key.includes("bench")) return CLUSTER_META.eval.color;
  // fallback: hash
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return CLUSTER_PALETTE[Math.abs(h) % CLUSTER_PALETTE.length];
}

export function hexAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) {
    return `rgba(0,0,0,${alpha})`;
  }
  const h = hex.length === 4
    ? "#" + hex.slice(1).split("").map((c) => c + c).join("")
    : hex;
  const n = parseInt(h.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function confidenceColor(c: number): string {
  if (c >= 0.8) return "var(--good)";
  if (c >= 0.55) return "var(--warn)";
  return "var(--bad)";
}

export function categoryBg(cat: Category): string {
  return hexAlpha(CATEGORY_META[cat].color, 0.13);
}
