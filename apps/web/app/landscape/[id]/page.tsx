import Link from "next/link";
import { apiGet, Landscape, LandscapePaper } from "../../../lib/api";
import { ExportButton } from "../../../components/ExportButton";

export const dynamic = "force-dynamic";

export default async function LandscapeOverview({ params }: { params: { id: string } }) {
  let landscape: Landscape | null = null;
  let papers: LandscapePaper[] = [];
  let loadError: string | null = null;
  try {
    [landscape, papers] = await Promise.all([
      apiGet<Landscape>(`/api/landscapes/${params.id}`),
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`).catch(() => [] as LandscapePaper[]),
    ]);
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!landscape) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold mb-2">Landscape</h1>
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3 mb-3">
          Could not load this landscape: {loadError || "not found"}
        </div>
        <Link href="/search" className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm">
          New landscape
        </Link>
      </div>
    );
  }

  const s = landscape.synthesis || {};
  const hasSynthesis = !!(
    s.field_overview ||
    s.why_it_matters ||
    (Array.isArray(s.clusters) && s.clusters.length) ||
    (Array.isArray(s.open_problems) && s.open_problems.length)
  );
  const mustRead = papers.filter((p) => p.category === "must-read");

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-xs text-neutral-500 uppercase tracking-wide">Landscape</div>
          <h1 className="text-2xl font-semibold">{landscape.topic}</h1>
          <div className="text-xs text-neutral-500">
            status: {landscape.status} · {papers.length} papers
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/landscape/${landscape.id}/papers`}
            className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm"
          >
            Papers ({papers.length})
          </Link>
          <Link
            href={`/landscape/${landscape.id}/reading-plan`}
            className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm"
          >
            Reading plan
          </Link>
          <Link
            href={`/landscape/${landscape.id}/quiz`}
            className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm"
          >
            Quiz
          </Link>
          <Link
            href={`/landscape/${landscape.id}/flashcards`}
            className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm"
          >
            Flashcards
          </Link>
          <ExportButton landscapeId={landscape.id} />
        </div>
      </div>

      {!hasSynthesis && papers.length > 0 && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mb-4">
          Synthesis is empty — either the pipeline is still running or the LLM provider didn&apos;t produce content. Papers are still browsable.
        </div>
      )}

      <section className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 prose-fieldmap">
          <h2>Field overview</h2>
          <p>{s.field_overview || <em>Not generated yet.</em>}</p>

          <h2>Why it matters</h2>
          <p>{s.why_it_matters || <em>Not generated yet.</em>}</p>

          <h2>Clusters</h2>
          {Array.isArray(s.clusters) && s.clusters.length > 0 ? (
            <div className="space-y-3">
              {s.clusters.map((c: any, i: number) => (
                <div key={i} className="border border-neutral-200 rounded-md p-3 bg-white">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-neutral-700">{c.summary}</div>
                  {Array.isArray(c.paper_ids) && c.paper_ids.length > 0 && (
                    <div className="mt-1 text-xs text-neutral-500">{c.paper_ids.length} papers</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p>
              <em>No clusters yet.</em>
            </p>
          )}

          <h2>Open problems</h2>
          {renderList(s.open_problems)}

          <h2>Project ideas</h2>
          {renderList(s.project_ideas)}

          <h2>Tensions</h2>
          {renderList(s.tensions)}

          <h2>Skip for now</h2>
          {renderList(s.skip_for_now)}
        </div>

        <aside className="space-y-4">
          <div className="border border-neutral-200 rounded-md p-3 bg-white">
            <div className="font-medium mb-1">Must-read</div>
            {mustRead.length === 0 ? (
              <div className="text-sm text-neutral-500">None ranked must-read.</div>
            ) : (
              <ul className="text-sm space-y-1">
                {mustRead.map((p) => (
                  <li key={p.paper.id}>
                    <Link href={`/paper/${p.paper.id}`}>{p.paper.title}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-neutral-200 rounded-md p-3 bg-white">
            <div className="font-medium mb-1">Prerequisites</div>
            {renderList(s.prerequisites, "text-sm")}
          </div>

          <div className="border border-neutral-200 rounded-md p-3 bg-white">
            <div className="font-medium mb-1">Datasets & benchmarks</div>
            {renderList(s.datasets_benchmarks, "text-sm")}
          </div>
        </aside>
      </section>
    </div>
  );
}

function renderList(items: any, cls = "") {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <p>
        <em>None.</em>
      </p>
    );
  }
  return (
    <ul className={cls}>
      {items.map((x: any, i: number) => (
        <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>
      ))}
    </ul>
  );
}
