"use client";

// Client-side API + local retention for the Learn surfaces (design §9/§10).
//
// Writes carry the web build's catalogue hash; the api requires an exact
// match and answers 409 catalogue_version_mismatch otherwise. On 409 the
// operation is preserved locally (keyed by client_attempt_id, so an eventual
// resubmission is exactly the original attempt) and retried — lessons stay
// readable throughout, only syncing pauses.

import { apiGet, apiPost, apiPut } from "./api";
import { getStoredUser, getToken } from "./auth";

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

export class StorageUnavailableError extends Error {
  constructor() {
    super("learn_storage_unavailable");
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

export type CheckpointAttemptPayload = {
  lessonSlug: string;
  lessonVersion: number;
  checkpointSlug: string;
  catalogHash: string;
  responses: Record<string, number>;
  clientAttemptId: string;
};

export async function postCheckpointAttempt(a: CheckpointAttemptPayload): Promise<CheckpointResult> {
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

// ---- User-scoped write-ahead outbox for unsynchronised learning writes ----
const OUTBOX_KEY = "fm-learn-outbox-v2";
const MAX_OUTBOX_ENTRIES = 50;
const RETENTION_MS = 1000 * 60 * 60 * 24 * 21;
const inflight = new Set<string>();
const progressInflight = new Set<string>();
let revisionCounter = 0;

type BaseOutboxEntry = {
  id: string;
  ownerUserId: string;
  lessonSlug: string;
  lessonVersion: number;
  catalogHash: string;
  revision: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
};

export type PendingProgress = BaseOutboxEntry & {
  kind: "progress";
  lastBlockId: string;
};

export type PendingCheckpoint = BaseOutboxEntry & {
  kind: "checkpoint";
  checkpointSlug: string;
  responses: Record<string, number>;
  clientAttemptId: string;
};

export type LearningOutboxEntry = PendingProgress | PendingCheckpoint;

export type StorageResult<T> =
  | { ok: true; entry: T }
  | { ok: false; reason: "no_current_user" | "storage_unavailable" };

export type LessonOutboxContext = {
  lessonSlug: string;
  lessonVersion: number;
  catalogHash: string;
  blockIds: string[];
  checkpointSlug: string;
  questions: { id: string; options: string[] }[];
};

export type RetryEvent =
  | { kind: "progress-synced"; entry: PendingProgress }
  | { kind: "checkpoint-synced"; entry: PendingCheckpoint; result: CheckpointResult }
  | { kind: "retry-paused"; entry: LearningOutboxEntry; reason: "mismatch" | "offline" }
  | {
      kind: "incompatible";
      entry: LearningOutboxEntry;
      reason: "lesson-version-changed" | "missing-block" | "invalid-checkpoint";
    };

export function currentLearnUserId(): string | null {
  if (typeof window === "undefined") return null;
  if (!getToken()) return null;
  return getStoredUser()?.id ?? null;
}

function nextRevision(): string {
  revisionCounter += 1;
  return `${Date.now().toString(36)}-${revisionCounter.toString(36)}`;
}

function progressEntryId(ownerUserId: string, lessonSlug: string, lessonVersion: number): string {
  return `progress:${ownerUserId}:${lessonSlug}:${lessonVersion}`;
}

function parseEntries(raw: string | null): LearningOutboxEntry[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): LearningOutboxEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    if (entry.kind !== "progress" && entry.kind !== "checkpoint") return [];
    if (typeof entry.id !== "string" || !entry.id) return [];
    if (typeof entry.ownerUserId !== "string" || !entry.ownerUserId) return [];
    if (typeof entry.lessonSlug !== "string" || typeof entry.lessonVersion !== "number") return [];
    if (typeof entry.catalogHash !== "string") return [];
    if (typeof entry.createdAt !== "number" || typeof entry.updatedAt !== "number") return [];
    const base = {
      ...entry,
      revision:
        typeof entry.revision === "string" && entry.revision
          ? entry.revision
          : `legacy:${entry.updatedAt}:${entry.id}`,
    };
    if (entry.kind === "progress") {
      if (typeof entry.lastBlockId !== "string") return [];
      return [base as PendingProgress];
    }
    if (
      typeof entry.checkpointSlug !== "string" ||
      typeof entry.clientAttemptId !== "string" ||
      entry.responses == null ||
      typeof entry.responses !== "object"
    ) {
      return [];
    }
    return [base as PendingCheckpoint];
  });
}

function pruneEntries(entries: LearningOutboxEntry[], now = Date.now()): LearningOutboxEntry[] {
  return entries
    .filter((entry) => now - entry.updatedAt <= RETENTION_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-MAX_OUTBOX_ENTRIES);
}

function readAllEntries(): LearningOutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return pruneEntries(parseEntries(localStorage.getItem(OUTBOX_KEY)));
  } catch {
    return [];
  }
}

function writeAllEntries(entries: LearningOutboxEntry[]): void {
  if (typeof window === "undefined") throw new StorageUnavailableError();
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(pruneEntries(entries)));
  } catch {
    throw new StorageUnavailableError();
  }
}

export function readLearningOutbox(): LearningOutboxEntry[] {
  return readAllEntries();
}

export function savePendingProgress(body: {
  lessonSlug: string;
  lessonVersion: number;
  catalogHash: string;
  lastBlockId: string;
}): StorageResult<PendingProgress> {
  const ownerUserId = currentLearnUserId();
  if (!ownerUserId) return { ok: false, reason: "no_current_user" };
  const now = Date.now();
  const id = progressEntryId(ownerUserId, body.lessonSlug, body.lessonVersion);
  const entries = readAllEntries();
  const rest = entries.filter((entry) => entry.id !== id);
  const previous = entries.find((entry) => entry.id === id);
  const entry: PendingProgress = {
    kind: "progress",
    id,
    ownerUserId,
    lessonSlug: body.lessonSlug,
    lessonVersion: body.lessonVersion,
    catalogHash: body.catalogHash,
    revision: nextRevision(),
    lastBlockId: body.lastBlockId,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    attempts: 0,
  };
  try {
    writeAllEntries([...rest, entry]);
    return { ok: true, entry };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export function savePendingCheckpoint(body: CheckpointAttemptPayload): StorageResult<PendingCheckpoint> {
  const ownerUserId = currentLearnUserId();
  if (!ownerUserId) return { ok: false, reason: "no_current_user" };
  const now = Date.now();
  const id = `checkpoint:${ownerUserId}:${body.clientAttemptId}`;
  const entries = readAllEntries();
  const previous = entries.find((entry) => entry.id === id);
  const rest = entries.filter((entry) => entry.id !== id);
  const entry: PendingCheckpoint = {
    kind: "checkpoint",
    id,
    ownerUserId,
    lessonSlug: body.lessonSlug,
    lessonVersion: body.lessonVersion,
    checkpointSlug: body.checkpointSlug,
    catalogHash: body.catalogHash,
    revision: previous?.revision ?? nextRevision(),
    responses: body.responses,
    clientAttemptId: body.clientAttemptId,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    attempts: previous?.attempts ?? 0,
  };
  try {
    writeAllEntries([...rest, entry]);
    return { ok: true, entry };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export function clearPendingOperation(entryId: string, expectedRevision?: string): void {
  try {
    writeAllEntries(
      readAllEntries().filter((entry) => {
        if (entry.id !== entryId) return true;
        return expectedRevision != null && entry.revision !== expectedRevision;
      })
    );
  } catch {
    /* If clear fails, the in-flight guard and idempotency key still prevent duplicates. */
  }
}

function markAttempted(entry: LearningOutboxEntry): void {
  const entries = readAllEntries();
  const idx = entries.findIndex(
    (candidate) => candidate.id === entry.id && candidate.revision === entry.revision
  );
  if (idx < 0) return;
  entries[idx] = { ...entries[idx], attempts: entries[idx].attempts + 1, updatedAt: Date.now() };
  writeAllEntries(entries);
}

function readProgressEntry(entryId: string): PendingProgress | null {
  const entry = readAllEntries().find(
    (candidate): candidate is PendingProgress =>
      candidate.kind === "progress" && candidate.id === entryId
  );
  return entry ?? null;
}

function checkpointMatches(entry: PendingCheckpoint, ctx: LessonOutboxContext): boolean {
  if (entry.checkpointSlug !== ctx.checkpointSlug) return false;
  const byId = new Map(ctx.questions.map((q) => [q.id, q.options.length]));
  for (const [questionId, answer] of Object.entries(entry.responses)) {
    const optionCount = byId.get(questionId);
    if (optionCount == null) return false;
    if (!Number.isInteger(answer) || answer < 0 || answer >= optionCount) return false;
  }
  return ctx.questions.every((q) =>
    Object.prototype.hasOwnProperty.call(entry.responses, q.id)
  );
}

export async function flushProgressOutbox(
  ctx: LessonOutboxContext,
  onEvent: (event: RetryEvent) => void
): Promise<void> {
  const ownerUserId = currentLearnUserId();
  if (!ownerUserId) return;
  const entryId = progressEntryId(ownerUserId, ctx.lessonSlug, ctx.lessonVersion);
  if (progressInflight.has(entryId)) return;

  progressInflight.add(entryId);
  try {
    while (true) {
      const entry = readProgressEntry(entryId);
      if (!entry) return;
      if (entry.ownerUserId !== ownerUserId || entry.lessonSlug !== ctx.lessonSlug) return;
      if (entry.lessonVersion !== ctx.lessonVersion) {
        onEvent({ kind: "incompatible", entry, reason: "lesson-version-changed" });
        return;
      }
      if (!ctx.blockIds.includes(entry.lastBlockId)) {
        onEvent({ kind: "incompatible", entry, reason: "missing-block" });
        return;
      }

      try {
        markAttempted(entry);
        await putLessonProgress({
          lessonSlug: entry.lessonSlug,
          lessonVersion: entry.lessonVersion,
          catalogHash: ctx.catalogHash,
          lastBlockId: entry.lastBlockId,
        });
        clearPendingOperation(entry.id, entry.revision);
        onEvent({ kind: "progress-synced", entry });
      } catch (e) {
        const latest = readProgressEntry(entryId);
        if (latest && latest.revision !== entry.revision) continue;
        onEvent({
          kind: "retry-paused",
          entry,
          reason: e instanceof CatalogueMismatchError ? "mismatch" : "offline",
        });
        return;
      }
    }
  } finally {
    progressInflight.delete(entryId);
  }
}

async function retryOne(entry: LearningOutboxEntry, ctx: LessonOutboxContext): Promise<RetryEvent | null> {
  const ownerUserId = currentLearnUserId();
  if (!ownerUserId || entry.ownerUserId !== ownerUserId) return null;
  if (entry.lessonSlug !== ctx.lessonSlug) return null;
  if (entry.kind === "progress") {
    await flushProgressOutbox(ctx, () => {});
    return null;
  }
  if (inflight.has(entry.id)) return null;
  if (entry.lessonVersion !== ctx.lessonVersion) {
    return { kind: "incompatible", entry, reason: "lesson-version-changed" };
  }
  if (!checkpointMatches(entry, ctx)) {
    return { kind: "incompatible", entry, reason: "invalid-checkpoint" };
  }

  inflight.add(entry.id);
  try {
    markAttempted(entry);
    const result = await postCheckpointAttempt({
      lessonSlug: entry.lessonSlug,
      lessonVersion: entry.lessonVersion,
      checkpointSlug: entry.checkpointSlug,
      catalogHash: ctx.catalogHash,
      responses: entry.responses,
      clientAttemptId: entry.clientAttemptId,
    });
    clearPendingOperation(entry.id, entry.revision);
    return { kind: "checkpoint-synced", entry, result };
  } catch (e) {
    return {
      kind: "retry-paused",
      entry,
      reason: e instanceof CatalogueMismatchError ? "mismatch" : "offline",
    };
  } finally {
    inflight.delete(entry.id);
  }
}

export async function retryLessonOutbox(
  ctx: LessonOutboxContext,
  onEvent: (event: RetryEvent) => void
): Promise<void> {
  for (const entry of readAllEntries()) {
    if (entry.kind === "progress") {
      await flushProgressOutbox(ctx, onEvent);
      continue;
    }
    const event = await retryOne(entry, ctx);
    if (event) onEvent(event);
  }
}
