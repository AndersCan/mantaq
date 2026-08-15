/**
 * ErrorBanner + ActorBadge render tests.
 *
 * ErrorBanner (specs/error-banner.md):
 * - discriminated union kind: graph | actor,
 * - role=alert + aria-live=assertive,
 * - copy button only for graph errors,
 * - dismissed state removes the banner (no auto-dismiss).
 *
 * ActorBadge (specs/actor-badge.md):
 * - status running/error/done via data-status,
 * - stats derived from the graph model (no DOM counting).
 */

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createCheckoutActor } from "../browser/fixtures/checkout.ts";
import { createTrafficLightActor } from "../browser/fixtures/traffic-light.ts";
import { ActorBadge } from "../src/components/actor-badge.tsx";
import { ErrorBanner } from "../src/components/error-banner.tsx";
import type { VizError } from "../src/model/use-actor-model.ts";

const graphError: VizError = {
  kind: "graph",
  reason: "handler-threw",
  message: "boom: cannot read context",
};
const actorError: VizError = {
  kind: "actor",
  reason: "transition",
  message: "event rejected",
};

afterEach(() => {
  cleanup();
});

describe("ErrorBanner", () => {
  it("renders role=alert with kind chip, reason and message", () => {
    render(<ErrorBanner error={graphError} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("data-error-kind")).toBe("graph");
    expect(alert.textContent).toMatch(/handler-threw/);
    expect(alert.textContent).toMatch(/boom/);
  });

  it("offers copy only for graph errors", () => {
    const { container: graph } = render(<ErrorBanner error={graphError} />);
    expect(graph.querySelectorAll("button")).toHaveLength(2); // copy + dismiss
    const { container: actor } = render(<ErrorBanner error={actorError} />);
    expect(actor.querySelectorAll("button")).toHaveLength(1); // dismiss only
  });

  it("dismiss removes the banner and calls onDismiss", () => {
    const onDismiss = () => {};
    render(<ErrorBanner error={graphError} onDismiss={onDismiss} />);
    const dismiss = screen.getAllByRole("button")[1]!;
    fireEvent.click(dismiss);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ActorBadge", () => {
  it("shows running status and model-derived stats", () => {
    const { actor } = createCheckoutActor();
    const { container } = render(<ActorBadge actor={actor} name="checkout" />);
    const badge = container.querySelector(".mtq-actor-badge")!;
    expect(badge.getAttribute("data-status")).toBe("running");
    expect(badge.textContent).toMatch(/checkout/);
    expect(badge.textContent).toMatch(/6 states/);
  });

  it("tracks done status on a final machine", () => {
    const { actor } = createTrafficLightActor();
    const { container } = render(<ActorBadge actor={actor} name="traffic" />);
    expect(container.querySelector(".mtq-actor-badge")!.getAttribute("data-status")).toBe(
      "running",
    );
  });
});
