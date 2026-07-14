"use client";

// Client-side API + local retention for the Learn surfaces (design §9/§10).
//
// Writes carry the web build's catalogue hash; the api requires an exact
// match and answers 409 catalogue_version_mismatch otherwise. On 409 the
// operation is preserved locally (keyed by client_attempt_id, so an eventual
// resubmission is exactly the original attempt) and retried — lessons stay
// readable throughout, only syncing pauses.

import { apiGet, apiPost, apiPut } from "./api";

export type LessonProgress = {
  lesson_slug: string;
  lesson_version: number;
  status: "in_progress" | "completed";
  last_block_id: string | null;
  best_checkpoint_score: number | null;
  updated_at: string;
};

export type LearnProgress = {
  curriculum_slug: string;
  curriculum_version: number;
  catalog_hash: string;
  curriculum: {
    curriculum_slug: string;
    status: string;
    current_topic_slug: string | null;
  }[];
  lessons: LessonProgress[];
};

export type CheckpointResult = {
  duplicate: boolean;
  score: number;
  passed: boolean;
  per_question: Record<string, { answer: number; correct: boolean }>;
  best_checkpoint_score: number | null;
  lesson_status: string | null;
};

export class CatalogueMismatchError extends Error {
  constructor() {
    super("catalogue_version_mismatch");
  }
}

function isMismatch(e: unknown): boolean {
  return e instanceof Error && e.message.includes("catalogue_version_mismatch");
}

export async function getLearnProgress(): Promise<LearnProgress> {
  return apiGet<LearnProgress>("/api/learn/progress");
}

export async function putLessonProgress(body: {
  lessonSlug: string;
  lessonVersion: number;
  catalogHash: string;
  lastBlockId: string;
}): Promise<void> {
  try {
    await apiPut(`/api/learn/lessons/${body.lessonSlug}/progress`, {
      lesson_version: body.lessonVersion,
      catalog_hash: body.catalogHash,
      last_block_id: body.lastBlockId,
    });
  } catch (e) {
    if (isMismatch(e)) throw new CatalogueMismatchError();
    throw e;
  }
}

export type PendingAttempt = {
  lessonSlug: string;
  lessonVersion: number;
  checkpointSlug: string;
  catalogHash: string;
  responses: Record<string, number>;
  clientAttemptId: string;
};

export async function postCheckpointAttempt(a: PendingAttempt): Promise<CheckpointResult> {
  try {
    return await apiPost<CheckpointResult>(
      `/api/learn/lessons/${a.lessonSlug}/checkpoint-attempts`,
      {
        lesson_version: a.lessonVersion,
        checkpoint_slug: a.checkpointSlug,
        catalog_hash: a.catalogHash,
        responses: a.responses,
        client_attempt_id: a.clientAttemptId,
      }
    );
  } catch (e) {
    if (isMismatch(e)) throw new CatalogueMismatchError();
    throw e;
  }
}

// ---- Local retention of unsynchronised attempts (never silently dropped) --
const PENDING_KEY = "fm-learn-pending-attempts";

export function readPendingAttempts(): PendingAttempt[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch {
    return [];
  }
}

export function savePendingAttempt(a: PendingAttempt): void {
  const rest = readPendingAttempts().filter((p) => p.clientAttemptId !== a.clientAttemptId);
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...rest, a]));
  } catch {
    /* storage full/blocked: nothing else we can do client-side */
  }
}

export function clearPendingAttempt(clientAttemptId: string): void {
  const rest = readPendingAttempts().filter((p) => p.clientAttemptId !== clientAttemptId);
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rest));
  } catch {
    /* noop */
  }
}
