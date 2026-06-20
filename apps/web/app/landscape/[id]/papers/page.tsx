import Link from "next/link";
import { apiGet, LandscapePaper } from "../../../../lib/api";

export const dynamic = "force-dynamic";

const ORDER: Record<string, number> = {
  "must-read": 0,
  useful: 1,
  optional: 2,
  "skip-for-now": 3,
};
const COLORS: Record<string, string> = {
  "must-read": "bg-amber-100 text-amber-900 border-amber-200",
  useful: "bg-emerald-100 text-emerald-900 border-emerald-200",
  optional: "bg-neutral-100 text-neutral-700 border-neutral-200",
  "skip-for-now": "bg-neutral-50 text-neutral-500 border-neutral-200",
};

export default async function PapersPage({ params }: { params: { id: string } }) {
  let papers: LandscapePaper[] = [];
  let err: string | null = null;
  try {
    papers = await apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`);
  } catch (e: any) {
    err = e?.message || String(e);
  }
  const sorted = [...papers].sort(
    (a, b) =>
      (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9) || b.score - a.score
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Papers</h1>
      <p className="text-sm text-neutral-600 mb-4">{papers.length} papers ranked.</p>
      {err && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {err}
        </div>
      )}
      {!err && papers.length === 0 && (
        <div className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded p-3 mb-3">
          No papers yet — the landscape job may still be running, or returned zero candidates.
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((p) => (
          <article
            key={p.paper.id}
            className="border border-neutral-200 rounded-md bg-white p-3 flex items-start gap-3"
          >
            <div className="w-12 text-right">
              <div className="font-mono text-sm">{p.score.toFixed(2)}</div>
              <span
                className={`mt-1 inline-block text-[10px] uppercase tracking-wide border px-1.5 py-0.5 rounded ${
                  COLORS[p.category] ?? COLORS.optional
                }`}
              >
                {p.category}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <Link href={`/paper/${p.paper.id}`} className="font-medium hover:underline">
                {p.paper.title}
              </Link>
              <div className="text-xs text-neutral-500 truncate">
                {p.paper.year ?? "—"} ·{" "}
                {p.paper.authors.slice(0, 3).join(", ")}
                {p.paper.authors.length > 3 ? ", …" : ""}
                {p.paper.arxiv_id ? ` · arXiv:${p.paper.arxiv_id}` : ""}
              </div>
              {p.paper.abstract && (
                <p className="text-sm text-neutral-700 mt-1 line-clamp-2">{p.paper.abstract}</p>
              )}
              {p.rationale && (
                <div className="text-xs text-neutral-500 mt-1">{p.rationale}</div>
              )}
            </div>
            <div className="text-xs flex flex-col items-end gap-1">
              {p.paper.url && (
                <a href={p.paper.url} target="_blank" rel="noreferrer">
                  abs
                </a>
              )}
              {p.paper.pdf_url && (
                <a href={p.paper.pdf_url} target="_blank" rel="noreferrer">
                  pdf
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
