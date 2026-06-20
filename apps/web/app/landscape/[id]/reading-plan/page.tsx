import Link from "next/link";
import { apiGet, Landscape, LandscapePaper } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ReadingPlanPage({ params }: { params: { id: string } }) {
  const [landscape, papers] = await Promise.all([
    apiGet<Landscape>(`/api/landscapes/${params.id}`),
    apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`).catch(() => []),
  ]);
  const synth = landscape.synthesis || {};
  let steps: any[] = Array.isArray(synth.reading_path) ? synth.reading_path : [];

  // Fallback: order by reading_order then category then score
  if (steps.length === 0) {
    steps = [...papers]
      .filter((p) => p.reading_order !== null && p.reading_order !== undefined)
      .sort((a, b) => (a.reading_order || 0) - (b.reading_order || 0))
      .map((p) => ({ paper_id: p.paper.id, title: p.paper.title, why: p.rationale }));
  }
  if (steps.length === 0) {
    steps = papers
      .filter((p) => p.category === "must-read")
      .map((p) => ({ paper_id: p.paper.id, title: p.paper.title, why: "Ranked must-read" }));
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-4">Reading plan — {landscape.topic}</h1>
      {steps.length === 0 ? (
        <p className="text-sm text-neutral-600">No reading plan yet.</p>
      ) : (
        <ol className="space-y-3">
          {steps.map((s: any, i: number) => {
            const p = papers.find((pp) => pp.paper.id === s.paper_id);
            return (
              <li key={i} className="flex gap-3">
                <div className="font-mono text-sm text-neutral-500 w-6 text-right">{i + 1}.</div>
                <div className="flex-1">
                  {p ? (
                    <Link href={`/paper/${p.paper.id}`} className="font-medium">
                      {s.title || p.paper.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{s.title}</span>
                  )}
                  {s.why && <div className="text-sm text-neutral-700">{s.why}</div>}
                  {s.cluster && <div className="text-xs text-neutral-500">cluster: {s.cluster}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
