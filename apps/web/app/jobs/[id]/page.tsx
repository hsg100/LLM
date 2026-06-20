"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, Job, JobEvent } from "../../../lib/api";

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  searching: "Searching papers",
  deduplicating: "Deduplicating",
  embedding_ranking: "Embedding & ranking",
  downloading_pdfs: "Downloading PDFs",
  parsing_pdfs: "Parsing PDFs",
  extracting: "Extracting paper notes",
  synthesising: "Synthesising landscape",
  active_recall: "Generating quiz & flashcards",
  done: "Done",
  failed: "Failed",
};

const STAGE_ORDER = [
  "searching",
  "deduplicating",
  "embedding_ranking",
  "downloading_pdfs",
  "parsing_pdfs",
  "extracting",
  "synthesising",
  "active_recall",
  "done",
];

export default function JobPage({ params }: { params: { id: string } }) {
  const search = useSearchParams();
  const landscapeId = search.get("landscape");
  const [job, setJob] = useState<Job | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const j = await apiGet<Job>(`/api/jobs/${params.id}`);
        if (stopped) return;
        setJob(j);
        setPollErr(null);
        if (j.stage === "done" || j.stage === "failed") return;
        setTimeout(tick, 1500);
      } catch (e: any) {
        if (stopped) return;
        setPollErr(e.message || String(e));
        // keep polling — the API might just be starting up
        setTimeout(tick, 3000);
      }
    }
    tick();
    return () => {
      stopped = true;
    };
  }, [params.id]);

  const events: JobEvent[] = useMemo(() => job?.events ?? [], [job]);

  const usedFallback = useMemo(
    () => events.some((e) => e.meta && (e.meta as any).fallback === true) ||
      events.some((e) => (e.meta as any)?.source === "stub"),
    [events]
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Building landscape</h1>
      <p className="text-sm text-neutral-600 mb-4">
        Job <span className="font-mono">{params.id.slice(0, 8)}</span> ·{" "}
        {job?.stage ? STAGE_LABELS[job.stage] ?? job.stage : "loading…"}
        {usedFallback && (
          <span className="ml-2 inline-block text-[10px] uppercase tracking-wide border px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border-amber-200">
            dev fallback
          </span>
        )}
      </p>

      {pollErr && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
          Couldn&apos;t reach the API: <span className="font-mono">{pollErr}</span>. Retrying…
        </div>
      )}

      <div className="w-full h-2 bg-neutral-200 rounded mb-6 overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <ol className="space-y-1">
          {STAGE_ORDER.map((stage) => {
            const reached =
              job &&
              (STAGE_ORDER.indexOf(job.stage) >= STAGE_ORDER.indexOf(stage) || job.stage === "done");
            const active = job?.stage === stage;
            return (
              <li
                key={stage}
                className={`text-sm flex items-center gap-2 ${
                  active ? "font-medium" : reached ? "text-neutral-700" : "text-neutral-400"
                }`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    reached ? "bg-accent" : "bg-neutral-300"
                  }`}
                />
                {STAGE_LABELS[stage]}
              </li>
            );
          })}
        </ol>

        <div className="bg-white border border-neutral-200 rounded-md p-3 h-80 overflow-auto text-xs font-mono">
          {events.length === 0 && <div className="text-neutral-400">no events yet…</div>}
          {events.map((e, i) => (
            <EventRow key={i} ev={e} />
          ))}
        </div>
      </div>

      {job?.stage === "done" && landscapeId && (
        <div className="mt-6 flex gap-3">
          <Link
            href={`/landscape/${landscapeId}`}
            className="bg-ink text-white px-4 py-2 rounded-md"
          >
            View landscape →
          </Link>
          <Link
            href={`/landscape/${landscapeId}/papers`}
            className="border border-neutral-300 px-4 py-2 rounded-md"
          >
            Papers
          </Link>
        </div>
      )}

      {job?.stage === "failed" && (
        <div className="mt-6">
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3">
            <strong>Job failed.</strong> {job.error || "(no error message recorded)"}
          </div>
          <div className="mt-3 flex gap-2">
            <Link href="/search" className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm">
              Start a new landscape
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ ev }: { ev: JobEvent }) {
  const meta = ev.meta || null;
  const isError = !!(meta && (meta as any).error_type);
  const isFallback = !!(meta && ((meta as any).fallback || (meta as any).source === "stub"));
  return (
    <div className={`py-0.5 ${isError ? "text-red-700" : isFallback ? "text-amber-800" : ""}`}>
      <span className="text-neutral-400">{new Date(ev.ts).toLocaleTimeString()}</span>{" "}
      <span className="text-neutral-500">[{ev.stage}]</span> {ev.message}
      {meta && (
        <details className="ml-6 my-0.5">
          <summary className="cursor-pointer text-[10px] text-neutral-400">meta</summary>
          <pre className="whitespace-pre-wrap break-all text-[10px] bg-neutral-50 p-1.5 rounded mt-0.5">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
