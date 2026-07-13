import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * /review must handle real-data, empty and API-unavailable states honestly
 * (recovery plan §11 Phase 1, task 6).
 */

const apiGet = vi.fn();
vi.mock("../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
}));

import ReviewHubPage from "../app/review/page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReviewHubPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiGet.mockReset();
});

describe("Review hub", () => {
  it("routes to each ready landscape's existing review screen", async () => {
    apiGet.mockResolvedValue([
      { id: "a", topic: "RAG evaluation", status: "ready" },
      { id: "b", topic: "Being built", status: "running" },
    ]);
    renderPage();
    const link = await screen.findByRole("link", { name: "Review →" });
    expect(link).toHaveAttribute("href", "/landscape/a/review");
    // running landscapes have no review material yet
    expect(screen.queryByText("Being built")).not.toBeInTheDocument();
  });

  it("shows an honest empty state", async () => {
    apiGet.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/nothing to review yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /build your first landscape/i })).toHaveAttribute(
      "href",
      "/search"
    );
  });

  it("shows an explicit failure state when the API is unavailable", async () => {
    apiGet.mockRejectedValue(new Error("GET /api/landscapes → network error"));
    renderPage();
    // the page retries once (retryDelay ~1s) before surfacing the failure
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
      /couldn't reach the api/i
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
