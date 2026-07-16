import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiPost = vi.fn();
const apiPut = vi.fn();
const apiGet = vi.fn();
vi.mock("../lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

import { LessonRuntime } from "../components/learn/LessonRuntime";
import { setSession } from "../lib/auth";
import {
  clearCurrentUserLearningOutbox,
  readLearningOutbox,
  retryLessonOutbox,
  savePendingCheckpoint,
  savePendingProgress,
} from "../lib/learn";

const OUTBOX_KEY = "fm-learn-outbox-v2";
const USER_A = { id: "user-a", email: "a@example.com", name: "A", is_admin: false };
const USER_B = { id: "user-b", email: "b@example.com", name: "B", is_admin: false };

const PROPS = {
  lessonSlug: "tokens-and-tokenisers",
  lessonVersion: 1,
  catalogHash: "hash-current",
  blockIds: ["b1", "b2"],
  checkpointSlug: "tokens-checkpoint",
  passScore: 0.8,
  questions: [
    { id: "q1", prompt: "Q1?", options: ["a", "b"] },
    { id: "q2", prompt: "Q2?", options: ["c", "d"] },
  ],
};

const EMPTY_PROGRESS = {
  curriculum_slug: "llm-pathway",
  curriculum_version: 1,
  catalog_hash: "hash-current",
  curriculum: [],
  lessons: [],
};

type ObserverInstance = {
  elements: Element[];
  cb: IntersectionObserverCallback;
  observe: (el: Element) => void;
  disconnect: () => void;
};

let observers: ObserverInstance[] = [];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

class MockIntersectionObserver {
  elements: Element[] = [];
  constructor(private cb: IntersectionObserverCallback) {
    observers.push(this as unknown as ObserverInstance);
  }
  observe = (el: Element) => {
    this.elements.push(el);
  };
  disconnect = () => {
    this.elements = [];
  };
}

function setUser(user = USER_A) {
  localStorage.setItem("fm-auth-token", `token-${user.id}`);
  localStorage.setItem("fm-auth-user", JSON.stringify(user));
}

function renderRuntime(props = PROPS) {
  document.body.insertAdjacentHTML("beforeend", '<div id="block-b1"></div><div id="block-b2"></div>');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LessonRuntime {...props} />
    </QueryClientProvider>
  );
}

function outbox(): any[] {
  return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
}

async function triggerBlock(blockId: string) {
  const target = document.getElementById(`block-${blockId}`)!;
  let observer: ObserverInstance | undefined;
  for (let i = 0; i < 5 && !observer; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    observer = observers.find((candidate) => candidate.elements.includes(target));
  }
  expect(observer).toBeTruthy();
  await act(async () => {
    observer!.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], observer as any);
    vi.advanceTimersByTime(1600);
  });
}

async function waitUntilObserved(blockId: string) {
  const target = document.getElementById(`block-${blockId}`)!;
  await waitFor(() => {
    expect(observers.some((candidate) => candidate.elements.includes(target))).toBe(true);
  });
}

function answerAll() {
  fireEvent.click(screen.getByRole("radio", { name: "b" }));
  fireEvent.click(screen.getByRole("radio", { name: "c" }));
}

function checkpointEntry(overrides: Record<string, unknown> = {}) {
  return {
    kind: "checkpoint",
    id: "checkpoint:user-a:attempt-original",
    ownerUserId: "user-a",
    lessonSlug: PROPS.lessonSlug,
    lessonVersion: 1,
    checkpointSlug: PROPS.checkpointSlug,
    catalogHash: "hash-old",
    responses: { q1: 1, q2: 0 },
    clientAttemptId: "attempt-original",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  observers = [];
  document.body.innerHTML = "";
  localStorage.clear();
  setUser();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiGet.mockResolvedValue(EMPTY_PROGRESS);
  apiPost.mockResolvedValue({
    duplicate: false,
    score: 1.0,
    passed: true,
    per_question: { q1: { answer: 1, correct: true }, q2: { answer: 0, correct: true } },
    best_checkpoint_score: 1.0,
    lesson_status: "completed",
  });
  apiPut.mockResolvedValue({});
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("crypto", { randomUUID: () => "attempt-new" });
});

describe("reading-position outbox", () => {
  it("retains a failed progress PUT locally under the signed-in user", async () => {
    apiPut.mockRejectedValue(new Error("PUT → network error"));
    renderRuntime();
    await waitUntilObserved("b1");
    vi.useFakeTimers();

    await triggerBlock("b1");
    vi.useRealTimers();

    await screen.findByText(/reading position saved on this device/i);
    expect(outbox()).toMatchObject([
      {
        kind: "progress",
        ownerUserId: "user-a",
        lessonSlug: PROPS.lessonSlug,
        lessonVersion: 1,
        catalogHash: "hash-current",
        lastBlockId: "b1",
      },
    ]);
  });

  it("retries retained progress with the current hash and clears it on success", async () => {
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        {
          kind: "progress",
          id: "progress:user-a:tokens-and-tokenisers:1",
          ownerUserId: "user-a",
          lessonSlug: PROPS.lessonSlug,
          lessonVersion: 1,
          catalogHash: "hash-old",
          lastBlockId: "b2",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        },
      ])
    );

    renderRuntime();

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0] as [string, any];
    expect(body.catalog_hash).toBe("hash-current");
    expect(body.last_block_id).toBe("b2");
    expect(outbox()).toEqual([]);
  });

  it("serializes progress writes and preserves the newest retained position across failure", async () => {
    const puts: Deferred[] = [];
    apiPut.mockImplementation(() => {
      const next = deferred();
      puts.push(next);
      return next.promise;
    });
    renderRuntime();
    await waitUntilObserved("b1");
    vi.useFakeTimers();

    await triggerBlock("b1");
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(outbox()).toMatchObject([{ kind: "progress", lastBlockId: "b1" }]);

    await triggerBlock("b2");
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(outbox()).toMatchObject([{ kind: "progress", lastBlockId: "b2" }]);

    await act(async () => {
      puts[0].resolve({});
      await Promise.resolve();
    });
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(2);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ kind: "progress", lastBlockId: "b2" });

    await act(async () => {
      puts[1].reject(new Error("PUT → network error"));
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByText(/reading position saved on this device/i)).toBeInTheDocument();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ kind: "progress", ownerUserId: "user-a", lastBlockId: "b2" });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(3);
    const delivered = apiPut.mock.calls.map(([, body]) => body.last_block_id);
    expect(delivered).toEqual(["b1", "b2", "b2"]);

    await act(async () => {
      puts[2].resolve({});
      await Promise.resolve();
    });
    await settle();
    expect(outbox()).toEqual([]);
    vi.useRealTimers();
  });

  it("does not let an older progress completion clear a newer revision", async () => {
    const b1 = deferred();
    apiPut.mockReturnValueOnce(b1.promise).mockRejectedValueOnce(new Error("PUT → network error"));
    renderRuntime();
    await waitUntilObserved("b1");
    vi.useFakeTimers();

    await triggerBlock("b1");
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(1);
    const firstRevision = outbox()[0].revision;

    await triggerBlock("b2");
    await settle();
    const secondRevision = outbox()[0].revision;
    expect(secondRevision).not.toBe(firstRevision);

    await act(async () => {
      b1.resolve({});
      await Promise.resolve();
    });
    await settle();
    expect(apiPut).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/reading position saved on this device/i)).toBeInTheDocument();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ lastBlockId: "b2", revision: secondRevision });
    vi.useRealTimers();
  });

  it("does not submit a backward progress update after loading a later stored resume position", async () => {
    apiGet.mockResolvedValue({
      ...EMPTY_PROGRESS,
      lessons: [
        {
          lesson_slug: PROPS.lessonSlug,
          lesson_version: 1,
          status: "in_progress",
          last_block_id: "b2",
          best_checkpoint_score: null,
          updated_at: "2026-07-14T00:00:00Z",
        },
      ],
    });
    renderRuntime();
    await waitUntilObserved("b1");
    vi.useFakeTimers();

    await triggerBlock("b1");
    expect(apiPut).not.toHaveBeenCalled();
    expect(outbox()).toEqual([]);
    vi.useRealTimers();
  });

  it("does not create parallel progress PUTs across duplicate mounts and online events", async () => {
    const pending = deferred();
    apiPut.mockReturnValue(pending.promise);
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        {
          kind: "progress",
          id: "progress:user-a:tokens-and-tokenisers:1",
          ownerUserId: "user-a",
          lessonSlug: PROPS.lessonSlug,
          lessonVersion: 1,
          catalogHash: "hash-old",
          revision: "stored-revision",
          lastBlockId: "b2",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        },
      ])
    );

    renderRuntime();
    renderRuntime();
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    pending.resolve({});
    await waitFor(() => expect(outbox()).toEqual([]));
  });

  it("does not submit retained progress when its block id is no longer valid", async () => {
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        {
          kind: "progress",
          id: "progress:user-a:tokens-and-tokenisers:1",
          ownerUserId: "user-a",
          lessonSlug: PROPS.lessonSlug,
          lessonVersion: 1,
          catalogHash: "hash-old",
          lastBlockId: "missing-block",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        },
      ])
    );

    renderRuntime();

    await screen.findByText(/saved reading position no longer matches/i);
    expect(apiPut).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(1);
  });

  it("does not falsely claim local save when storage is unavailable", async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new Error("blocked");
      return original.call(this, key, value);
    });
    renderRuntime();
    await waitUntilObserved("b1");
    vi.useFakeTimers();

    await triggerBlock("b1");
    vi.useRealTimers();

    await screen.findByText(/automatic local saving is unavailable/i);
    expect(apiPut).not.toHaveBeenCalled();
  });
});

describe("checkpoint outbox", () => {
  it("persists a checkpoint attempt before the network request is allowed to finish", async () => {
    apiPost.mockImplementation(() => new Promise(() => {}));
    renderRuntime();

    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(outbox()).toMatchObject([
      {
        kind: "checkpoint",
        ownerUserId: "user-a",
        clientAttemptId: "attempt-new",
        responses: { q1: 1, q2: 0 },
      },
    ]);
  });

  it("successful synchronization clears only the exact matching entry and revision", async () => {
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        checkpointEntry({
          id: "checkpoint:user-a:other",
          lessonSlug: "other-lesson",
          clientAttemptId: "other",
        }),
      ])
    );
    renderRuntime();

    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Passed · 100%");
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].clientAttemptId).toBe("other");
  });

  it("reconciles a same-version retained entry to the current catalogue hash", async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([checkpointEntry()]));

    renderRuntime();

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [, body] = apiPost.mock.calls[0] as [string, any];
    expect(body.catalog_hash).toBe("hash-current");
    expect(body.client_attempt_id).toBe("attempt-original");
    expect(outbox()).toEqual([]);
  });

  it("does not automatically submit a changed-version checkpoint", async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([checkpointEntry({ lessonVersion: 0 })]));

    renderRuntime();

    await screen.findByText(/lesson changed since those answers were saved/i);
    expect(apiPost).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(1);
  });

  it("does not submit a retained checkpoint with changed or missing question ids", async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([checkpointEntry({ responses: { q1: 1, old: 0 } })]));

    renderRuntime();

    await screen.findByText(/saved checkpoint answers no longer match/i);
    expect(apiPost).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(1);
  });

  it("never submits one user's retained operation under another user", async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([checkpointEntry()]));
    setUser(USER_B);

    renderRuntime();

    await act(async () => {});
    expect(apiPost).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(1);
  });

  it("does not create concurrent submissions across duplicate mounts", async () => {
    apiPost.mockImplementation(() => new Promise(() => {}));
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([checkpointEntry()]));

    renderRuntime();
    renderRuntime();

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  });

  it("preserves client_attempt_id across network recovery", async () => {
    apiPost.mockRejectedValueOnce(new Error("POST → network error")).mockResolvedValueOnce({
      duplicate: true,
      score: 0.5,
      passed: false,
      per_question: {},
      best_checkpoint_score: 0.5,
      lesson_status: "in_progress",
    });
    renderRuntime();

    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    await screen.findByText(/answers are saved on this device/i);
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    const [, retryBody] = apiPost.mock.calls[1] as [string, any];
    expect(retryBody.client_attempt_id).toBe("attempt-new");
    expect(outbox()).toEqual([]);
  });

  it("does not falsely claim checkpoint answers were saved when storage is unavailable", async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new Error("blocked");
      return original.call(this, key, value);
    });
    renderRuntime();

    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));

    await screen.findByText(/automatic local saving is unavailable/i);
    expect(apiPost).not.toHaveBeenCalled();
  });
});


describe("outbox durability boundaries", () => {
  const context = {
    lessonSlug: PROPS.lessonSlug,
    lessonVersion: PROPS.lessonVersion,
    catalogHash: PROPS.catalogHash,
    blockIds: PROPS.blockIds,
    checkpointSlug: PROPS.checkpointSlug,
    questions: PROPS.questions.map(({ id, options }) => ({ id, options })),
  };

  function payload(clientAttemptId: string) {
    return {
      lessonSlug: PROPS.lessonSlug,
      lessonVersion: PROPS.lessonVersion,
      checkpointSlug: PROPS.checkpointSlug,
      catalogHash: PROPS.catalogHash,
      responses: { q1: 1, q2: 0 },
      clientAttemptId,
    };
  }

  it("retains a checkpoint older than the former 21-day boundary", () => {
    const old = Date.now() - 22 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([checkpointEntry({ createdAt: old, updatedAt: old, revision: "old" })])
    );

    expect(readLearningOutbox()).toHaveLength(1);
    expect(readLearningOutbox()[0]).toMatchObject({
      kind: "checkpoint",
      clientAttemptId: "attempt-original",
      responses: { q1: 1, q2: 0 },
    });
  });

  it("retains more than 50 pending checkpoints", () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      checkpointEntry({
        id: `checkpoint:user-a:attempt-${index}`,
        clientAttemptId: `attempt-${index}`,
        revision: `revision-${index}`,
      })
    );
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));

    const retained = readLearningOutbox();
    expect(retained).toHaveLength(60);
    expect(retained.every((entry) => entry.kind === "checkpoint")).toBe(true);
  });

  it("does not count-evict checkpoints from a mixed progress/checkpoint outbox", () => {
    const checkpoints = Array.from({ length: 55 }, (_, index) =>
      checkpointEntry({
        id: `checkpoint:user-a:mixed-${index}`,
        clientAttemptId: `mixed-${index}`,
        revision: `mixed-revision-${index}`,
      })
    );
    const progress = Array.from({ length: 6 }, (_, index) => ({
      kind: "progress",
      id: `progress:user-a:lesson-${index}:1`,
      ownerUserId: "user-a",
      lessonSlug: `lesson-${index}`,
      lessonVersion: 1,
      catalogHash: "hash-current",
      revision: `progress-revision-${index}`,
      lastBlockId: "b1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    }));
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...progress, ...checkpoints]));

    const retained = readLearningOutbox();
    expect(retained).toHaveLength(61);
    expect(retained.filter((entry) => entry.kind === "checkpoint")).toHaveLength(55);
  });

  it("compacts progress only by user, lesson, and lesson version", () => {
    const otherUserProgress = {
      kind: "progress",
      id: `progress:user-b:${PROPS.lessonSlug}:1`,
      ownerUserId: "user-b",
      lessonSlug: PROPS.lessonSlug,
      lessonVersion: 1,
      catalogHash: "hash-current",
      revision: "user-b-revision",
      lastBlockId: "b1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    };
    localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        otherUserProgress,
        checkpointEntry({ id: "checkpoint:user-a:unrelated", clientAttemptId: "unrelated" }),
      ])
    );

    expect(
      savePendingProgress({
        lessonSlug: PROPS.lessonSlug,
        lessonVersion: 1,
        catalogHash: PROPS.catalogHash,
        lastBlockId: "b1",
      }).ok
    ).toBe(true);
    expect(
      savePendingProgress({
        lessonSlug: PROPS.lessonSlug,
        lessonVersion: 1,
        catalogHash: PROPS.catalogHash,
        lastBlockId: "b2",
      }).ok
    ).toBe(true);
    expect(
      savePendingProgress({
        lessonSlug: PROPS.lessonSlug,
        lessonVersion: 2,
        catalogHash: PROPS.catalogHash,
        lastBlockId: "b1",
      }).ok
    ).toBe(true);

    const retained = readLearningOutbox();
    const currentVersion = retained.filter(
      (entry) =>
        entry.kind === "progress" &&
        entry.ownerUserId === "user-a" &&
        entry.lessonSlug === PROPS.lessonSlug &&
        entry.lessonVersion === 1
    );
    expect(currentVersion).toHaveLength(1);
    expect(currentVersion[0]).toMatchObject({ lastBlockId: "b2" });
    expect(retained).toContainEqual(otherUserProgress);
    expect(retained.some((entry) => entry.kind === "progress" && entry.lessonVersion === 2)).toBe(true);
    expect(retained.some((entry) => entry.kind === "checkpoint")).toBe(true);
  });

  it("preserves the original checkpoint through repeated network outages", async () => {
    expect(savePendingCheckpoint(payload("outage-attempt")).ok).toBe(true);
    apiPost.mockRejectedValue(new Error("POST → network error"));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await retryLessonOutbox(context, vi.fn());
    }

    expect(apiPost).toHaveBeenCalledTimes(3);
    expect(readLearningOutbox()).toMatchObject([
      {
        kind: "checkpoint",
        clientAttemptId: "outage-attempt",
        responses: { q1: 1, q2: 0 },
      },
    ]);
  });

  it("preserves the original attempt and responses through persistent catalogue mismatch", async () => {
    expect(savePendingCheckpoint(payload("mismatch-attempt")).ok).toBe(true);
    apiPost.mockRejectedValue(new Error("409 catalogue_version_mismatch"));
    const events: any[] = [];

    await retryLessonOutbox(context, (event) => events.push(event));
    await retryLessonOutbox(context, (event) => events.push(event));

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.kind === "retry-paused" && event.reason === "mismatch")).toBe(true);
    expect(readLearningOutbox()).toMatchObject([
      {
        kind: "checkpoint",
        clientAttemptId: "mismatch-attempt",
        responses: { q1: 1, q2: 0 },
      },
    ]);
  });

  it("preserves a checkpoint after retry exhaustion responses", async () => {
    expect(savePendingCheckpoint(payload("retry-bound-attempt")).ok).toBe(true);
    apiPost.mockRejectedValue(new Error("POST → 503 transient database contention"));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await retryLessonOutbox(context, vi.fn());
    }

    expect(apiPost).toHaveBeenCalledTimes(4);
    expect(readLearningOutbox()).toMatchObject([
      {
        kind: "checkpoint",
        clientAttemptId: "retry-bound-attempt",
        responses: { q1: 1, q2: 0 },
      },
    ]);
  });

  it("leaves the previously stored outbox byte-for-byte intact on quota failure", () => {
    const existing = [
      checkpointEntry({ lessonVersion: 0, revision: "existing-a" }),
      checkpointEntry({
        id: "checkpoint:user-b:existing-b",
        ownerUserId: "user-b",
        clientAttemptId: "existing-b",
        revision: "existing-b",
      }),
    ];
    const raw = JSON.stringify(existing);
    localStorage.setItem(OUTBOX_KEY, raw);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    });

    const saved = savePendingCheckpoint(payload("quota-attempt"));

    expect(saved).toEqual({ ok: false, reason: "storage_capacity" });
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(raw);
  });

  it("shows an honest persistent recovery state when a new attempt cannot fit", async () => {
    const existing = [
      checkpointEntry({ lessonVersion: 0, revision: "existing-a" }),
      checkpointEntry({
        id: "checkpoint:user-b:existing-b",
        ownerUserId: "user-b",
        clientAttemptId: "existing-b",
        revision: "existing-b",
      }),
    ];
    const raw = JSON.stringify(existing);
    localStorage.setItem(OUTBOX_KEY, raw);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    });

    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));

    expect(await screen.findByText(/browser storage is full/i)).toBeInTheDocument();
    expect(screen.getByText(/new checkpoint attempt was not saved or submitted/i)).toBeInTheDocument();
    const recovery = screen.getByRole("textbox", { name: /learning recovery data/i });
    const recoveryText = (recovery as HTMLTextAreaElement).value;
    expect(recoveryText).toContain("attempt-new");
    expect(recoveryText).not.toContain("user-b");
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(raw);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("requires separate explicit confirmation before clearing current-user pending work", async () => {
    const existing = [
      checkpointEntry({ lessonVersion: 0, revision: "existing-a" }),
      checkpointEntry({
        id: "checkpoint:user-b:existing-b",
        ownerUserId: "user-b",
        clientAttemptId: "existing-b",
        revision: "existing-b",
      }),
    ];
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(existing));
    const original = Storage.prototype.setItem;
    let failedOnce = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY && !failedOnce) {
        failedOnce = true;
        throw new DOMException("full", "QuotaExceededError");
      }
      return original.call(this, key, value);
    });

    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    await screen.findByText(/browser storage is full/i);

    fireEvent.click(screen.getByRole("button", { name: /clear 1 saved pending write/i }));
    expect(outbox()).toHaveLength(2);
    expect(screen.getByRole("button", { name: /confirm clear 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm clear 1/i }));
    await screen.findByText(/stored pending work was cleared/i);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ ownerUserId: "user-b", clientAttemptId: "existing-b" });
  });

  it("hides recovery data after an account change and never clears another user", async () => {
    const existing = [
      checkpointEntry({ lessonVersion: 0, revision: "existing-a" }),
      checkpointEntry({
        id: "checkpoint:user-b:existing-b",
        ownerUserId: "user-b",
        clientAttemptId: "existing-b",
        revision: "existing-b",
      }),
    ];
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(existing));
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    });

    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    await screen.findByRole("textbox", { name: /learning recovery data/i });

    act(() => setSession("token-user-b", USER_B));

    await screen.findByText(/recovery data is hidden because the signed-in account changed/i);
    expect(screen.queryByRole("textbox", { name: /learning recovery data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear .* pending/i })).not.toBeInTheDocument();

    vi.restoreAllMocks();
    const cleared = clearCurrentUserLearningOutbox();
    expect(cleared).toEqual({ ok: true, cleared: 1 });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ ownerUserId: "user-a", clientAttemptId: "attempt-original" });
  });
});
