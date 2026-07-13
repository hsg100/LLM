import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 1 mobile navigation contract: the bottom tab bar shows the
 * product-level surfaces by default and preserves the landscape-scoped tabs
 * inside research routes (recovery plan §11 Phase 1, tasks 4–5).
 */

const navState = { pathname: "/" };

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { BottomTabBar } from "../components/shell/BottomTabBar";

function hrefOf(name: string): string | null {
  return (screen.getByRole("link", { name }) as HTMLAnchorElement).getAttribute("href");
}

beforeEach(() => {
  localStorage.clear();
  navState.pathname = "/";
});

describe("BottomTabBar product mode", () => {
  it("shows Home / Learn / Research / Review / Search outside research routes", () => {
    render(<BottomTabBar />);
    expect(hrefOf("Home")).toBe("/");
    expect(hrefOf("Learn")).toBe("/learn");
    expect(hrefOf("Research")).toBe("/landscapes");
    expect(hrefOf("Review")).toBe("/review");
    expect(hrefOf("Search")).toBe("/search");
  });

  it("has no locked tabs in product mode", () => {
    render(<BottomTabBar />);
    expect(screen.queryByTitle("Select a landscape first")).not.toBeInTheDocument();
  });
});

describe("BottomTabBar landscape mode", () => {
  it("preserves scoped tabs inside a landscape, with Home returning to product home", () => {
    navState.pathname = "/landscape/abc/quiz";
    render(<BottomTabBar />);
    expect(hrefOf("Home")).toBe("/");
    expect(hrefOf("Overview")).toBe("/landscape/abc");
    expect(hrefOf("Read")).toBe("/landscape/abc/reading-plan");
    expect(hrefOf("Learn")).toBe("/landscape/abc/quiz");
    expect(hrefOf("Map")).toBe("/landscape/abc/map");
  });

  it("uses the remembered landscape on paper pages", () => {
    localStorage.setItem("fm-last-landscape", "abc");
    navState.pathname = "/paper/some-paper";
    render(<BottomTabBar />);
    expect(hrefOf("Overview")).toBe("/landscape/abc");
  });
});
