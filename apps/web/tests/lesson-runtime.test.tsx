import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Phase 2 client sync contract (design §10): checkpoint submission grades
 * via the api; a 409 catalogue_version_mismatch preserves the attempt
 * locally under its client_attempt_id and tells the learner honestly; an
 * unreachable api does the same; retained attempts resubmit on revisit.
 */

const apiPost = vi.fn();
const apiPut = vi.fn();
const apiGet = vi.fn();
vi.mock("../lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

import { LessonRuntime } from "../components/learn/LessonRuntime";

const PROPS = {
  lessonSlug: "tokens-and-tokenisers",
  lessonVersion: 1,
  catalogHash: "hash-a",
  blockIds: ["b1", "b2"],
  checkpointSlug: "tokens-checkpoint",
  passScore: 0.8,
  questions: [
    { id: "q1", prompt: "Q1?", options: ["a", "b"] },
    { id: "q2", prompt: "Q2?", options: ["c", "d"] },
  ],
};

function renderRuntime() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LessonRuntime {...PROPS} />
    </QueryClientProvider>
  );
}

function answerAll() {
  fireEvent.click(screen.getByRole("radio", { name: "b" }));
  fireEvent.click(screen.getByRole("radio", { name: "c" }));
}

beforeEach(() => {
  localStorage.clear();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiGet.mockRejectedValue(new Error("api down"));
});

describe("Checkpoint submission", () => {
  it("submits answers and renders the graded result", async () => {
    apiPost.mockResolvedValue({
      duplicate: false,
      score: 1.0,
      passed: true,
      per_question: { q1: { answer: 1, correct: true }, q2: { answer: 0, correct: true } },
      best_checkpoint_score: 1.0,
      lesson_status: "completed",
    });
    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Passed · 100%");
    const [, body] = apiPost.mock.calls[0] as [string, any];
    expect(body.catalog_hash).toBe("hash-a");
    expect(body.responses).toEqual({ q1: 1, q2: 0 });
    expect(body.client_attempt_id).toBeTruthy();
  });

  it("preserves the attempt locally and explains honestly on 409 mismatch", async () => {
    apiPost.mockRejectedValue(
      new Error('POST → 409 — {"error":"catalogue_version_mismatch"}')
    );
    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    expect(
      await screen.findByText(/saved on this device — submission is paused/i)
    ).toBeInTheDocument();
    const pending = JSON.parse(localStorage.getItem("fm-learn-pending-attempts")!);
    expect(pending).toHaveLength(1);
    expect(pending[0].responses).toEqual({ q1: 1, q2: 0 });
    expect(pending[0].clientAttemptId).toBeTruthy();
  });

  it("preserves the attempt locally when the api is unreachable", async () => {
    apiPost.mockRejectedValue(new Error("POST → network error"));
    renderRuntime();
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: /check my understanding/i }));
    expect(await screen.findByText(/will be\s+resubmitted/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("fm-learn-pending-attempts")!)).toHaveLength(1);
  });

  it("resubmits a retained attempt with its original client_attempt_id", async () => {
    localStorage.setItem(
      "fm-learn-pending-attempts",
      JSON.stringify([
        {
          lessonSlug: PROPS.lessonSlug,
          lessonVersion: 1,
          checkpointSlug: PROPS.checkpointSlug,
          catalogHash: "hash-a",
          responses: { q1: 1, q2: 0 },
          clientAttemptId: "attempt-original",
        },
      ])
    );
    apiPost.mockResolvedValue({
      duplicate: true,
      score: 0.5,
      passed: false,
      per_question: {},
      best_checkpoint_score: 0.5,
      lesson_status: "in_progress",
    });
    renderRuntime();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/previously recorded/i)
    );
    const [, body] = apiPost.mock.calls[0] as [string, any];
    expect(body.client_attempt_id).toBe("attempt-original");
    expect(localStorage.getItem("fm-learn-pending-attempts")).toBe("[]");
  });
});

describe("Progress honesty", () => {
  it("says progress is unavailable but keeps the lesson readable when the api is down", async () => {
    apiPost.mockResolvedValue({});
    renderRuntime();
    expect(await screen.findByText(/progress is unavailable right now/i, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Q1\?/)).toBeInTheDocument();
  });
});
