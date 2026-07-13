import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LearnPage from "../app/learn/page";

/**
 * /learn must render fully statically (no API, worker or LLM provider) and be
 * honest: the curriculum is presented as planned/in-build, with no fabricated
 * lessons or progress (recovery plan §10 / Phase 1 quality bar).
 */
describe("Learn page", () => {
  it("renders without any backend and states the curriculum status honestly", () => {
    render(<LearnPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/in development/i);
    expect(screen.getByText("FIRST CURRICULUM — IN BUILD")).toBeInTheDocument();
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText("Tokens and tokenisation")).toBeInTheDocument();
    expect(screen.getByText("PLANNED LATER")).toBeInTheDocument();
  });

  it("bridges to the existing research workspace", () => {
    render(<LearnPage />);
    const research = screen.getByRole("link", { name: /research workspace/i });
    expect(research).toHaveAttribute("href", "/landscapes");
  });

  it("does not fabricate learner progress", () => {
    render(<LearnPage />);
    expect(screen.queryByText(/resume/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/% complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
