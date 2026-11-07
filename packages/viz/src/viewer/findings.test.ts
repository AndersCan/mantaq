// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: flags.initial ?? false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

const pick: VizStep = { kind: "event", event: "pick", payload: { side: "b" } };

/** `idle -pick-> picked`; `orphan` has no way in; `pick` in `idle` throws under fuzzing. */
const machine: VizMachine = {
  id: "flow",
  initial: "idle",
  regions: [],
  states: [state("idle", { initial: true }), state("picked"), state("orphan")],
  events: [{ id: "pick", internal: false, doc: null, payloadType: null }],
  outputs: [],
  edges: [edge("idle", "pick", "picked")],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [],
    errors: [{ from: "idle", event: "pick", message: "boom", steps: [pick] }],
  },
};

function driver(): VizDriver {
  const run = (steps: VizStep[]): VizLiveState => ({
    state: steps.length === 0 ? "idle" : "__error",
    steps,
    last:
      steps.length === 0
        ? null
        : {
            from: "idle",
            event: "pick",
            to: "__error",
            outcome: "ignored",
            effects: [],
            context: null,
            error: "boom",
          },
    timers: [],
    context: null,
  });
  return { reset: () => run([]), step: (step) => run([step]) };
}

function mount(live?: VizDriver): HTMLElement {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    live === undefined ? {} : { driver: live },
  );
  return root;
}

const mark = (root: HTMLElement, id: string) =>
  root.querySelector<SVGGElement>(`[data-node-id="${id}"] .finding-mark`);

describe("finding marks", () => {
  test("only states with findings carry a mark", () => {
    const root = mount();
    expect(root.querySelectorAll(".finding-mark")).toHaveLength(2);
    expect(mark(root, "idle")?.getAttribute("data-finding-count")).toBe("1");
    expect(mark(root, "idle")?.getAttribute("aria-label")).toContain("Handler throws");
    expect(mark(root, "orphan")?.getAttribute("aria-label")).toContain("Unreachable state");
    expect(mark(root, "picked")).toBeNull();
  });

  test("clicking a mark opens the details without taking the step", () => {
    const root = mount();
    // idle is the current state and `picked` its next step; marks sit on `idle`, so click via picked's neighbour
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("idle");
    const finding = root.querySelector('.state-findings .finding[data-kind="handlerError"]');
    expect(finding?.textContent).toContain("Handler throws");
    expect(finding?.textContent).toContain("Fuzzing sent this event");
    expect(finding?.textContent).toContain("pick in idle throws: boom");
    expect(finding?.textContent).toContain('pick {"side":"b"}');
  });

  test("Enter on a focused mark does the same", () => {
    const root = mount();
    mark(root, "orphan")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(root.querySelector('.finding[data-kind="unreachableState"]')).not.toBeNull();
  });

  test("an unreachable state has no path and nothing to replay", () => {
    const root = mount(driver());
    mark(root, "orphan")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".finding")?.textContent).toContain(
      "No event path reaches this state.",
    );
    expect(root.querySelector("[data-replay]")).toBeNull();
  });

  test("without a driver there is no Replay", () => {
    const root = mount();
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".finding")).not.toBeNull();
    expect(root.querySelector("[data-replay]")).toBeNull();
  });

  test("with a driver, Replay runs the steps and shows the Step tab", () => {
    const root = mount(driver());
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-replay]")?.click();
    expect(root.querySelector("[data-live-error]")?.textContent).toContain("boom");
  });
});
