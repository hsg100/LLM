import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Phase 1 root-route contract: `/` is the learner dashboard foundation
 * (recovery plan §4.4 / §11 Phase 1). It must present learning as the primary
 * experience, use only real review/research data, and stay honest when the
 * backend is empty or unavailable. The pre-Phase-1 redirect to /landscapes is
 * gone; /landscapes itself remains reachable via navigation.
 */

const apiGet = vi.fn();
const getReviewQueue = vi.fn();

vi.mock("../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  getReviewQueue: (...args: unknown[]) => getReviewQueue(...args),
}));

import HomePage from "../app/page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiGet.mockReset();
  getReviewQueue.mockReset();
});

describe("Home dashboard", () => {
  it("presents learning first and links to the pathway and research", async () => {
    apiGet.mockResolvedValue([]);
    renderPage();
    expect(
      screen.getByRole("heading", { name: /understand llms from first principles/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /preview the llm pathway/i })).toHaveAttribute(
      "href",
      "/learn"
    );
    expect(screen.getByRole("link", { name: /open research/i })).toHaveAttribute(
      "href",
      "/landscapes"
    );
    // no fabricated progress on a fresh account
    expect(await screen.findByText(/nothing to review yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows real due-for-review counts from existing landscapes", async () => {
    apiGet.mockResolvedValue([
      { id: "a", topic: "RAG evaluation", status: "ready" },
      { id: "b", topic: "LLM agents", status: "ready" },
    ]);
    getReviewQueue.mockImplementation(async (id: string) =>
      id === "a"
        ? { due_count: 3, new_count: 2, items: [], now: "", }
        : { due_count: 0, new_count: 0, items: [], now: "" }
    );
    renderPage();
    // appears in the aggregate header and in the per-landscape row
    expect((await screen.findAllByText("3 due · 2 unseen")).length).toBeGreaterThanOrEqual(1);
    const reviewLinks = screen
      .getAllByRole("link", { name: "Review →" })
      .map((a) => a.getAttribute("href"));
    expect(reviewLinks).toContain("/landscape/a/review");
    expect(reviewLinks).not.toContain("/landscape/b/review"); // nothing due there
  });

  it("lists recent research landscapes with real statuses", async () => {
    apiGet.mockResolvedValue([
      { id: "a", topic: "RAG evaluation", status: "ready" },
      { id: "c", topic: "Interpretability", status: "running" },
    ]);
    getReviewQueue.mockResolvedValue({ due_count: 0, new_count: 0, items: [], now: "" });
    renderPage();
    expect(await screen.findByText("Interpretability")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /all landscapes/i })).toHaveAttribute(
      "href",
      "/landscapes"
    );
  });

  it("degrades honestly when the API is unavailable", async () => {
    apiGet.mockRejectedValue(new Error("network down"));
    renderPage();
    const alerts = await screen.findAllByRole("alert", {}, { timeout: 4000 });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.map((a) => a.textContent).join(" ")).toMatch(/can't be reached|couldn't reach/i);
    // the hero and pathway link still render — the page never blanks
    expect(screen.getByRole("link", { name: /preview the llm pathway/i })).toBeInTheDocument();
  });
});
