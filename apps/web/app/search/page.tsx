"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "../../lib/api";

export default function SearchPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [maxPapers, setMaxPapers] = useState(30);
  const [parsePdfs, setParsePdfs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ landscape_id: string; job_id: string }>(
        "/api/landscapes",
        { topic: topic.trim(), max_papers: maxPapers, sources: ["arxiv"], parse_pdfs: parsePdfs }
      );
      router.push(`/jobs/${res.job_id}?landscape=${res.landscape_id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create landscape");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">New research landscape</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Enter a topic. FieldMap will search arXiv, rank papers, parse PDFs, extract
        structured notes, synthesise the landscape, generate active recall material,
        and let you export markdown into your Git-backed Obsidian research vault.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Topic</label>
          <input
            className="w-full border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="e.g. RAG evaluation"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Max papers</label>
            <input
              type="number"
              min={5}
              max={50}
              className="w-full border border-neutral-300 rounded-md px-3 py-2"
              value={maxPapers}
              onChange={(e) => setMaxPapers(Number(e.target.value))}
            />
          </div>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={parsePdfs}
              onChange={(e) => setParsePdfs(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Download &amp; parse PDFs</span>
          </label>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !topic.trim()}
          className="bg-ink text-white px-4 py-2 rounded-md disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start landscape"}
        </button>
      </form>
    </div>
  );
}
