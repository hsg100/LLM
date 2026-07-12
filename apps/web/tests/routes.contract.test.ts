import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Baseline route contract.
 *
 * The learning-platform transformation must not remove or relocate the
 * existing research surfaces (recovery plan §4.2 / §13). This test pins the
 * App Router page files for every legacy route so an accidental move or
 * deletion fails CI before it breaks a bookmark.
 */
const APP_DIR = join(__dirname, "..", "app");

const LEGACY_ROUTE_PAGES = [
  "landscapes/page.tsx",
  "landscape/[id]/page.tsx",
  "landscape/[id]/map/page.tsx",
  "landscape/[id]/papers/page.tsx",
  "landscape/[id]/reading-plan/page.tsx",
  "landscape/[id]/quiz/page.tsx",
  "landscape/[id]/flashcards/page.tsx",
  "landscape/[id]/review/page.tsx",
  "landscape/[id]/export/page.tsx",
  "landscape/[id]/concepts/[slug]/page.tsx",
  "paper/[id]/page.tsx",
  "jobs/page.tsx",
  "jobs/[id]/page.tsx",
  "search/page.tsx",
  "settings/page.tsx",
];

describe("legacy research routes stay in place", () => {
  it.each(LEGACY_ROUTE_PAGES)("app/%s exists", (page) => {
    expect(existsSync(join(APP_DIR, page))).toBe(true);
  });

  it("root route exists", () => {
    expect(existsSync(join(APP_DIR, "page.tsx"))).toBe(true);
  });
});
