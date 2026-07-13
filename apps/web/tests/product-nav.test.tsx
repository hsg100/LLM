import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 1 product navigation contract (recovery plan §4.1 / §11 Phase 1):
 * Home / Learn / Research / Review / Settings are the primary surfaces,
 * Research links to the EXISTING /landscapes workspace, research tools stay
 * reachable, and landscape-scoped navigation is preserved (locked without a
 * landscape, targeted when inside one).
 */

const navState = { pathname: "/" };

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../lib/api", () => ({
  apiGet: vi.fn(() =>
    Promise.resolve({ id: "abc", topic: "RAG evaluation", status: "ready" })
  ),
}));

import { Sidebar } from "../components/shell/Sidebar";

function linkByName(name: string): HTMLAnchorElement {
  return screen.getByRole("link", { name }) as HTMLAnchorElement;
}

beforeEach(() => {
  localStorage.clear();
  navState.pathname = "/";
});

describe("Sidebar product navigation", () => {
  it("shows Home / Learn / Research / Review / Settings with correct targets", () => {
    render(<Sidebar />);
    expect(linkByName("Home")).toHaveAttribute("href", "/");
    expect(linkByName("Learn")).toHaveAttribute("href", "/learn");
    expect(linkByName("Research")).toHaveAttribute("href", "/landscapes");
    expect(linkByName("Review")).toHaveAttribute("href", "/review");
    expect(linkByName("Settings")).toHaveAttribute("href", "/settings");
  });

  it("keeps research tools reachable without making them primary", () => {
    render(<Sidebar />);
    expect(linkByName("New landscape")).toHaveAttribute("href", "/search");
    expect(linkByName("Job monitor")).toHaveAttribute("href", "/jobs");
    expect(screen.getByText("RESEARCH TOOLS")).toBeInTheDocument();
  });

  it("locks landscape-scoped items when no landscape is selected", () => {
    render(<Sidebar />);
    const locked = screen.getAllByTitle("Select a landscape first");
    expect(locked.length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByRole("link", { name: "Field map" })).not.toBeInTheDocument();
  });

  it("preserves landscape-scoped navigation inside a landscape", () => {
    navState.pathname = "/landscape/abc/papers";
    render(<Sidebar />);
    expect(linkByName("Overview")).toHaveAttribute("href", "/landscape/abc");
    expect(linkByName("Field map")).toHaveAttribute("href", "/landscape/abc/map");
    expect(linkByName("Papers")).toHaveAttribute("href", "/landscape/abc/papers");
    expect(linkByName("Reading plan")).toHaveAttribute("href", "/landscape/abc/reading-plan");
    expect(linkByName("Quiz")).toHaveAttribute("href", "/landscape/abc/quiz");
    expect(linkByName("Flashcards")).toHaveAttribute("href", "/landscape/abc/flashcards");
    // "Review" appears twice: product-level (/review) and landscape-scoped
    const reviewHrefs = screen
      .getAllByRole("link", { name: "Review" })
      .map((a) => a.getAttribute("href"));
    expect(reviewHrefs).toContain("/review");
    expect(reviewHrefs).toContain("/landscape/abc/review");
    expect(linkByName("Obsidian export")).toHaveAttribute("href", "/landscape/abc/export");
    // product nav stays present inside research routes
    expect(linkByName("Research")).toHaveAttribute("href", "/landscapes");
  });
});
