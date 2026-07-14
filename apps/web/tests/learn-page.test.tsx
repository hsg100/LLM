import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Phase 2: /learn and its topic/lesson routes render deterministically from
 * the committed catalogue with the api mocked away entirely (design §13.1),
 * legacy honesty rules hold (planned topics unambiguous, no fabricated
 * progress), and unknown slugs 404.
 */

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const apiGet = vi.fn();
vi.mock("../lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

import LearnPage from "../app/learn/page";
import TopicPage from "../app/learn/[topic]/page";
import LessonPage from "../app/learn/[topic]/[lesson]/page";

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockRejectedValue(new Error("api unavailable"));
  localStorage.clear();
});

describe("Learn curriculum map (/learn)", () => {
  it("renders active topics as links and planned topics as unambiguous chips", async () => {
    wrap(<LearnPage />);
    expect(screen.getByText("Understanding LLMs from first principles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tokens and tokenisation/i })).toHaveAttribute(
      "href",
      "/learn/tokens-and-tokenisation"
    );
    expect(screen.getByRole("link", { name: /attention/i })).toHaveAttribute("href", "/learn/attention");
    expect(screen.getByText("PLANNED — NOT YET OPEN")).toBeInTheDocument();
    expect(screen.getByText("Transformer architecture")).not.toHaveAttribute("href");
    // progress section degrades honestly when the api is unreachable
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(/progress is unavailable/i);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows real progress when the api responds", async () => {
    apiGet.mockResolvedValue({
      curriculum_slug: "llm-pathway",
      curriculum_version: 1,
      catalog_hash: "x",
      curriculum: [],
      lessons: [
        {
          lesson_slug: "tokens-and-tokenisers",
          lesson_version: 1,
          status: "in_progress",
          last_block_id: null,
          best_checkpoint_score: null,
          updated_at: "2026-07-14T00:00:00",
        },
      ],
    });
    wrap(<LearnPage />);
    expect(await screen.findByText("0 completed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /continue/i })).toHaveAttribute(
      "href",
      "/learn/tokens-and-tokenisation/tokens-and-tokenisers"
    );
  });
});

describe("Topic route (/learn/[topic])", () => {
  it("renders an active topic's objectives and lesson links", () => {
    wrap(<TopicPage params={{ topic: "attention" }} />);
    expect(screen.getByRole("heading", { name: "Attention" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /attention as routing/i })).toHaveAttribute(
      "href",
      "/learn/attention/attention-routing"
    );
    expect(screen.getByText(/recommended, not enforced/i)).toBeInTheDocument();
  });

  it("404s for unknown or non-active topics", () => {
    expect(() => wrap(<TopicPage params={{ topic: "ghost-topic" }} />)).toThrow("NEXT_NOT_FOUND");
    expect(() => wrap(<TopicPage params={{ topic: "transformer-architecture" }} />)).toThrow(
      "NEXT_NOT_FOUND"
    );
  });
});

describe("Lesson route (/learn/[topic]/[lesson])", () => {
  it("renders narrative blocks, demo fallbacks and checkpoint without answers", async () => {
    wrap(<LessonPage params={{ topic: "attention", lesson: "attention-routing" }} />);
    expect(screen.getByRole("heading", { name: "Attention as routing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /queries, keys and values/i })).toBeInTheDocument();
    // demo placeholder is honest and carries the required fallback
    expect(screen.getByText(/arrives with phase 3/i)).toBeInTheDocument();
    expect(screen.getByText(/attention weights from the token "it"/i)).toBeInTheDocument();
    // checkpoint renders questions with no correctness marking pre-submit
    expect(screen.getByText(/checkpoint · pass at 80%/i)).toBeInTheDocument();
    expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
    // lesson body renders with the api down (content is bundled)
    expect(await screen.findByText(/lesson is fully readable/i, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("404s when the lesson does not belong to the topic", () => {
    expect(() =>
      wrap(<LessonPage params={{ topic: "attention", lesson: "sampling-controls" }} />)
    ).toThrow("NEXT_NOT_FOUND");
  });
});
