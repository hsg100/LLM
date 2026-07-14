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

  it("submits answers and clears only the matching successful entry", async () => {
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
