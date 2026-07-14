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

type ObserverInstance = {
  elements: Element[];
  cb: IntersectionObserverCallback;
  observe: (el: Element) => void;
  disconnect: () => void;
};

let observers: ObserverInstance[] = [];

class MockIntersectionObserver {
  elements: Element[] = [];
  constructor(private cb: IntersectionObserverCallback) {
    observers.push(this as unknown as ObserverInstance);
  }
  observe = (el: Element) => {
    this.elements.push(el);
  };
  disconnect = () => {};
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
  const observer = observers.find((candidate) => candidate.elements.includes(target));
  expect(observer).toBeTruthy();
  await act(async () => {
    observer!.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], observer as any);
    vi.advanceTimersByTime(1600);
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
  localStorage.clear();
  setUser();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiGet.mockRejectedValue(new Error("api down"));
  apiPost.mockResolvedValue({
    duplicate: false,
    score: 1.0,
    passed: true,
    per_question: { q1: { answer: 1, correct: true }, q2: { answer: 0, correct: true } },
    best_checkpoint_score: 1.0,
    lesson_status: "completed",
  });
  apiPut.mockResolvedValue({});
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("crypto", { randomUUID: () => "attempt-new" });
});

describe("reading-position outbox", () => {
  it("retains a failed progress PUT locally under the signed-in user", async () => {
    vi.useFakeTimers();
    apiPut.mockRejectedValue(new Error("PUT → network error"));
    renderRuntime();

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

  it("coalesces progress writes by user, lesson and version", async () => {
    vi.useFakeTimers();
    apiPut.mockRejectedValue(new Error("PUT → network error"));
    renderRuntime();

    await triggerBlock("b1");
    await triggerBlock("b2");
    vi.useRealTimers();

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ kind: "progress", ownerUserId: "user-a", lastBlockId: "b2" });
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
    vi.useFakeTimers();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === OUTBOX_KEY) throw new Error("blocked");
      return original.call(this, key, value);
    });
    renderRuntime();

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
