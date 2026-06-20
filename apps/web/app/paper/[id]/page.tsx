import { apiGet, apiUrl, PaperDetail } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PaperPage({ params }: { params: { id: string } }) {
  const d = await apiGet<PaperDetail>(`/api/papers/${params.id}`);
  const e = d.extraction || {};
  const localPdfUrl = d.pdf.url ? apiUrl(d.pdf.url, false) : null;

  return (
    <article className="max-w-3xl mx-auto prose-fieldmap">
      <h1>{d.paper.title}</h1>
      <p className="text-sm text-neutral-600">
        {d.paper.authors.join(", ")}
        {d.paper.year ? ` · ${d.paper.year}` : ""}
        {d.paper.venue ? ` · ${d.paper.venue}` : ""}
      </p>
      <p className="text-sm">
        {d.paper.url && (
          <a href={d.paper.url} target="_blank" rel="noreferrer">
            Abstract page
          </a>
        )}
        {d.paper.pdf_url && (
          <>
            {" · "}
            <a href={d.paper.pdf_url} target="_blank" rel="noreferrer">
              PDF
            </a>
          </>
        )}
      </p>

      {d.paper.abstract && (
        <>
          <h2>Abstract</h2>
          <p>{d.paper.abstract}</p>
        </>
      )}

      <section>
        <h2>PDF preview</h2>
        {localPdfUrl ? (
          <object data={localPdfUrl} type="application/pdf" className="w-full h-[70vh] border rounded">
            <iframe src={localPdfUrl} className="w-full h-[70vh] border rounded" title="PDF preview" />
          </object>
        ) : d.paper.pdf_url ? (
          <p>
            Local PDF is not available yet.{" "}
            <a href={d.paper.pdf_url} target="_blank" rel="noreferrer">
              Open external PDF
            </a>
          </p>
        ) : (
          <p>
            <em>No PDF URL available.</em>
          </p>
        )}
      </section>

      {d.extraction ? (
        <section>
          <h2>Structured notes</h2>
          {renderSection("Problem", e.problem)}
          {renderSection("Motivation", e.motivation)}
          {renderSection("Research question", e.research_question)}
          {renderSection("Method", e.method)}
          {renderSection("Contribution", e.contribution)}
          {renderSection("Novelty", e.novelty)}

          {bulletSection("Results", e.results)}
          {bulletSection("Limitations", e.limitations)}
          {bulletSection("Assumptions", e.assumptions)}
          {bulletSection("Datasets", e.datasets)}
          {bulletSection("Benchmarks", e.benchmarks)}
          {bulletSection("Baselines", e.baselines)}
          {bulletSection("Metrics", e.metrics)}
          {bulletSection("Implementation details", e.implementation_details)}
          {bulletSection("Mathematical ideas", e.mathematical_ideas)}
          {bulletSection("Prerequisites", e.prerequisites)}
          {bulletSection("Key terms", e.key_terms)}
          {bulletSection("Related papers", e.related_papers)}
          {bulletSection("Open questions", e.open_questions)}
          {bulletSection("Project ideas", e.project_ideas)}
          {bulletSection("Source grounding", e.source_grounding)}

          <p className="text-xs text-neutral-500">
            Difficulty: {e.difficulty_level}/5 · Reading priority: {e.reading_priority} · Confidence:{" "}
            {Number(e.confidence || 0).toFixed(2)}
          </p>
        </section>
      ) : (
        <p>
          <em>No extraction yet.</em>
        </p>
      )}

      <details className="mt-6">
        <summary>
          PDF status: <strong>{d.pdf.status}</strong>
          {d.pdf.bytes ? ` (${Math.round((d.pdf.bytes || 0) / 1024)} KB)` : ""}
          {d.pdf.error ? ` — ${d.pdf.error}` : ""}
        </summary>
        {d.sections.length > 0 && (
          <div className="mt-2">
            {d.sections.map((sec, i) => (
              <details key={i} className="my-2">
                <summary className="font-medium">{sec.heading || `Section ${i + 1}`}</summary>
                <pre className="whitespace-pre-wrap text-xs bg-neutral-50 p-2 rounded">
                  {sec.content}
                </pre>
              </details>
            ))}
          </div>
        )}
      </details>
    </article>
  );
}

function renderSection(label: string, value: any) {
  if (!value) return null;
  return (
    <>
      <h2>{label}</h2>
      <p>{value}</p>
    </>
  );
}

function bulletSection(label: string, items: any) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <>
      <h2>{label}</h2>
      <ul>
        {items.map((x: any, i: number) => (
          <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>
        ))}
      </ul>
    </>
  );
}
