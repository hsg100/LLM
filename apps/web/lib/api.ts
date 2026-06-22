// Single place that knows the API base URL. On the server we use the
// internal docker hostname; on the client we use the public one.

export const API_PUBLIC =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";
export const API_INTERNAL =
  process.env.API_URL_INTERNAL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export function apiUrl(path: string, isServer = typeof window === "undefined"): string {
  const base = isServer ? API_INTERNAL : API_PUBLIC;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 15000);

function timeoutSignal(init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (init?.signal) return { signal: init.signal, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

async function readErrorBody(r: Response): Promise<string> {
  try {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await r.json();
      return typeof j?.detail === "string" ? j.detail : JSON.stringify(j);
    }
    return (await r.text()).slice(0, 400);
  } catch {
    return "";
  }
}

export async function apiGet<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  let r: Response;
  const timeout = timeoutSignal(init, timeoutMs);
  try {
    r = await fetch(apiUrl(path), { cache: "no-store", ...init, signal: timeout.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`GET ${path} → timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new Error(`GET ${path} → network error: ${e?.message || e}`);
  } finally {
    timeout.cleanup();
  }
  if (!r.ok) {
    const body = await readErrorBody(r);
    throw new Error(`GET ${path} → ${r.status}${body ? ` — ${body}` : ""}`);
  }
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: any, init?: RequestInit, timeoutMs?: number): Promise<T> {
  let r: Response;
  const timeout = timeoutSignal(init, timeoutMs);
  try {
    r = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      ...init,
      signal: timeout.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`POST ${path} → timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new Error(`POST ${path} → network error: ${e?.message || e}`);
  } finally {
    timeout.cleanup();
  }
  if (!r.ok) {
    const errBody = await readErrorBody(r);
    throw new Error(`POST ${path} → ${r.status}${errBody ? ` — ${errBody}` : ""}`);
  }
  return r.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: any, init?: RequestInit, timeoutMs?: number): Promise<T> {
  let r: Response;
  const timeout = timeoutSignal(init, timeoutMs);
  try {
    r = await fetch(apiUrl(path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      ...init,
      signal: timeout.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`PATCH ${path} → timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new Error(`PATCH ${path} → network error: ${e?.message || e}`);
  } finally {
    timeout.cleanup();
  }
  if (!r.ok) {
    const errBody = await readErrorBody(r);
    throw new Error(`PATCH ${path} → ${r.status}${errBody ? ` — ${errBody}` : ""}`);
  }
  return r.json() as Promise<T>;
}

export async function cancelJob(jobId: string): Promise<Job> {
  return apiPost<Job>(`/api/jobs/${jobId}/cancel`, {});
}

export async function uploadPaper(
  landscapeId: string,
  file: File
): Promise<{ paper_id: string; title: string; parsed: boolean; sections: number; error: string | null }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(apiUrl(`/api/landscapes/${landscapeId}/papers/upload`), {
    method: "POST",
    body: fd,
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await readErrorBody(r);
    throw new Error(`Upload failed → ${r.status}${body ? ` — ${body}` : ""}`);
  }
  return r.json();
}

export type SettingsPatch = {
  llm_provider?: string;
  llm_model_fast?: string;
  llm_model_strong?: string;
  max_papers_per_landscape?: number;
  obsidian_export_auto_push?: boolean;
};

export async function updateSettings(patch: SettingsPatch): Promise<any> {
  return apiPatch<any>("/api/settings", patch);
}

// ---------------- Shared types (frontend mirror of backend Pydantic) ---
export type Paper = {
  id: string;
  source: string;
  external_id: string;
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  citation_count: number | null;
  pdf_url: string | null;
  arxiv_id: string | null;
  url: string | null;
};

export type LandscapePaper = {
  paper: Paper;
  score: number;
  category: "must-read" | "useful" | "optional" | "skip-for-now";
  rationale: string | null;
  cluster_id: string | null;
  reading_order: number | null;
};

export type Landscape = {
  id: string;
  topic: string;
  status: string;
  synthesis: any;
  settings: any;
  created_at: string;
  updated_at: string;
};

export type JobEvent = {
  ts: string;
  stage: string;
  message: string;
  progress: number;
  meta?: Record<string, any> | null;
};
export type Job = {
  id: string;
  landscape_id: string;
  stage: string;
  progress: number;
  cancel_requested?: boolean;
  events: JobEvent[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type Quiz = {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  paper_id: string | null;
  concept: string | null;
  difficulty: number;
};

export type Flashcard = {
  id: string;
  front: string;
  back: string;
  paper_id: string | null;
  concept: string | null;
  kind: string;
};

// ---- Active recall: review loop (FSRS) ----
export type ReviewRating = 1 | 2 | 3 | 4; // Again / Hard / Good / Easy

export type ReviewQueueItem = {
  item_kind: "quiz" | "flashcard";
  item_id: string;
  due: string | null;
  state: string;
  reps: number;
  lapses: number;
  quiz: Quiz | null;
  flashcard: Flashcard | null;
};

export type ReviewQueue = {
  now: string;
  due_count: number;
  new_count: number;
  items: ReviewQueueItem[];
};

export type ReviewResult = {
  item_kind: string;
  item_id: string;
  rating: number;
  correct: boolean | null;
  interval_days: number;
  due: string | null;
  state: string;
  reps: number;
  lapses: number;
  stability: number | null;
  difficulty: number | null;
};

export type WeakArea = {
  concept: string;
  attempts: number;
  correct: number;
  accuracy: number;
};

export async function getReviewQueue(landscapeId: string, limit = 40): Promise<ReviewQueue> {
  return apiGet<ReviewQueue>(`/api/landscapes/${landscapeId}/review/queue?limit=${limit}`);
}

export async function getWeakAreas(landscapeId: string): Promise<WeakArea[]> {
  return apiGet<WeakArea[]>(`/api/landscapes/${landscapeId}/review/weak-areas`);
}

export async function submitReview(
  landscapeId: string,
  body: { item_kind: "quiz" | "flashcard"; item_id: string; rating: ReviewRating; correct?: boolean }
): Promise<ReviewResult> {
  return apiPost<ReviewResult>(`/api/landscapes/${landscapeId}/review`, body);
}

export type PaperDetail = {
  paper: Paper;
  extraction: Record<string, any> | null;
  landscape_ids?: string[];
  pdf: { status: string; bytes: number | null; error: string | null; url: string | null; storage_path: string | null };
  sections: { heading: string | null; content: string }[];
  chunks: {
    id: string;
    section_id: string | null;
    section: string | null;
    page_start: number | null;
    page_end: number | null;
    ordinal: number;
    char_start: number | null;
    char_end: number | null;
    content: string;
  }[];
};

export type Concept = {
  id: string;
  landscape_id: string;
  term: string;
  slug: string;
  aliases: string[];
  short_definition: string;
  long_definition: string;
  why_it_matters: string;
  related_terms: string[];
  paper_ids: string[];
  source_grounding: Record<string, any>[];
  confidence: number;
  importance: number;
};

export type ConceptDetail = {
  concept: Concept;
  related_concepts: Concept[];
  papers: Paper[];
  source_grounding: Record<string, any>[];
  example_snippets: string[];
};

export type ConceptMap = {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; type: string }[];
};
