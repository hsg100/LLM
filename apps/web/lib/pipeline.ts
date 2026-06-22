// Canonical pipeline vocabulary for the frontend.
//
// MIRROR of apps/api/app/pipeline.py — keep the stage keys and their order in
// sync with PIPELINE_STAGES / JobStage there. Labels may differ from the
// backend STAGE_LABELS for UI purposes.

export type StageKey =
  | "queued"
  | "searching"
  | "deduplicating"
  | "embedding_ranking"
  | "downloading_pdfs"
  | "parsing_pdfs"
  | "extracting"
  | "synthesising"
  | "concepts"
  | "active_recall"
  | "done"
  | "failed";

export type LandscapeStatus = "queued" | "running" | "ready" | "failed";

// Ordered progress stages (excludes the out-of-band "failed").
export const STAGE_DEFS: { key: StageKey; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "searching", label: "Searching papers" },
  { key: "deduplicating", label: "Deduplicating" },
  { key: "embedding_ranking", label: "Embedding & ranking" },
  { key: "downloading_pdfs", label: "Downloading PDFs" },
  { key: "parsing_pdfs", label: "Parsing PDFs" },
  { key: "extracting", label: "Extracting notes" },
  { key: "synthesising", label: "Synthesising landscape" },
  { key: "concepts", label: "Generating concepts" },
  { key: "active_recall", label: "Quiz & flashcards" },
];

export const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGE_DEFS.map((s, i) => [s.key, i])
);

// Stages after which a job emits no further progress.
export const TERMINAL_STAGES: ReadonlySet<string> = new Set(["done", "failed"]);

export function isTerminalStage(stage: string | null | undefined): boolean {
  return !!stage && TERMINAL_STAGES.has(stage);
}

// A landscape is "ready" under either status the backend may report.
export function isLandscapeReady(status: string | null | undefined): boolean {
  return status === "ready" || status === "done";
}

export function isLandscapeRunning(status: string | null | undefined): boolean {
  return status === "running" || status === "queued";
}
