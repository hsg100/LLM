import { describe, expect, it, vi } from "vitest";

/**
 * Baseline behaviour of `/`: it redirects to the research workspace at
 * /landscapes. Phase 1 of the recovery plan replaces this redirect with the
 * learning dashboard — this test is updated alongside that change.
 */
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

describe("root route", () => {
  it("redirects to /landscapes (pre-Phase-1 baseline)", async () => {
    const { redirect } = await import("next/navigation");
    const { default: Home } = await import("../app/page");
    expect(() => Home()).toThrowError("NEXT_REDIRECT:/landscapes");
    expect(redirect).toHaveBeenCalledWith("/landscapes");
  });
});
