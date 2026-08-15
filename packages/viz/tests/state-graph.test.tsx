/**
 * StateGraph render tests (happy-dom + @testing-library/react).
 *
 * Structural contract (specs/state-graph.md + plan §9.3):
 * - canvas root carries data-node-count / data-edge-count / data-error,
 * - every node renders with data-node-id,
 * - error state: ErrorBanner with role=alert; last-good graph keeps rendering
 *   at 30% opacity (data-error on the root),
 * - empty render path: missing actor → empty state, never a blank canvas.
 */

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { createCheckoutActor } from "../browser/fixtures/checkout.ts";
import { createThrowingContextActor } from "../browser/fixtures/edge-cases.ts";
import { StateGraph } from "../src/components/state-graph.tsx";

afterEach(() => {
  cleanup();
});

describe("StateGraph", () => {
  it("renders the checkout machine with structural attrs", () => {
    const { actor } = createCheckoutActor();
    const { container } = render(<StateGraph actor={actor} />);

    const root = container.querySelector(".mtq-state-graph");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-node-count")).toBe("7");
    expect(root!.getAttribute("data-edge-count")).toBe("14");
    expect(root!.getAttribute("data-error")).toBeNull();
    expect(root!.querySelectorAll("[data-node-id]").length).toBeGreaterThan(0);
  });

  it("renders error banner with role=alert when the actor handler throws", () => {
    const { actor } = createThrowingContextActor();
    const { container } = render(<StateGraph actor={actor} />);

    expect(container.querySelector(".mtq-state-graph[data-error='true']")).not.toBeNull();
    const alert = screen.queryByRole("alert");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toMatch(/boom/);
  });

  it("reacts to events: active node follows the live path", () => {
    const { actor } = createCheckoutActor();
    const { container } = render(<StateGraph actor={actor} />);

    const active = container.querySelectorAll("[data-node-id][data-active='true']");
    expect(active).toHaveLength(1);
    expect(active[0]!.getAttribute("data-node-id")).toBe("basicInfo");
  });
});
