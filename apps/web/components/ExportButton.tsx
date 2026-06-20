"use client";

import { useState } from "react";
import { apiPost } from "../lib/api";

export function ExportButton({ landscapeId }: { landscapeId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await apiPost<{ files: string[]; commit_sha: string | null; pushed: boolean }>(
        `/api/landscapes/${landscapeId}/export/obsidian`,
        {}
      );
      setResult(
        `Wrote ${res.files.length} file${res.files.length === 1 ? "" : "s"}. ` +
          (res.commit_sha ? `commit ${res.commit_sha.slice(0, 7)}` : "no changes") +
          (res.pushed ? " · pushed" : "")
      );
    } catch (e: any) {
      setErr(e.message || "export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={go}
        disabled={busy}
        className="bg-accent text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export to Obsidian"}
      </button>
      {result && <div className="text-xs text-emerald-700 mt-1 max-w-[18rem] text-right">{result}</div>}
      {err && <div className="text-xs text-red-700 mt-1 max-w-[18rem] text-right">{err}</div>}
    </div>
  );
}
