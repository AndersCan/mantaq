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
  events: [{ id: "pick", internal: false, doc: null, payload: null }],
  outputs: [],
  context: null,
  edges: [edge("idle", "pick", "picked"), edge("picked", "pick", "idle")],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [],
    errors: [{ from: "idle", event: "pick", message: "boom", steps: [pick] }],
    failedExpectations: [],
    expectations: [],
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
    after: [],
    timers: [],
    context: null,
  });
  return { reset: () => run([]), step: (step) => run([step]) };
}

function mount(live?: VizDriver, shown: VizMachine = machine): HTMLElement {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shown] },
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

  const nextMarked: VizMachine = {
    ...machine,
    fuzz: {
      seed: 1,
      iterations: 1,
      corpus: [],
      errors: [{ from: "picked", event: "pick", message: "boom", steps: [pick] }],
      failedExpectations: [],
      expectations: [],
    },
  };

  test("a must-see finding says no run reached the context and offers no replay", () => {
    const mustSee: VizMachine = {
      ...machine,
      fuzz: {
        seed: 1,
        iterations: 5,
        corpus: [],
        errors: [],
        failedExpectations: [{ kind: "mustSee", state: "idle", match: '{"a":1}', steps: null }],
        expectations: [],
      },
    };
    const root = mount(undefined, mustSee);
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    const finding = root.querySelector('.finding[data-kind="mustSee"]');
    expect(finding?.textContent).toContain("Must-see context missed");
    expect(finding?.textContent).toContain("No fuzz run reached this context.");
    expect(finding?.querySelector("[data-replay]")).toBeNull();
  });

  test("clicking a mark on a next-step state does not take the step", () => {
    const root = mount(undefined, nextMarked);
    const target = mark(root, "picked");
    expect(target).not.toBeNull();
    target?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("idle");
    expect(root.querySelector('.finding[data-kind="handlerError"]')).not.toBeNull();
  });

  test("Space on a focused mark opens the details and prevents scrolling", () => {
    const root = mount(undefined, nextMarked);
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    mark(root, "picked")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("idle");
    expect(root.querySelector('.finding[data-kind="handlerError"]')).not.toBeNull();
  });

  test("other keys on a mark do nothing", () => {
    const root = mount();
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    mark(root, "orphan")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(root.querySelector(".finding")).toBeNull();
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
    const activeTab = () =>
      root.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tab");
    expect(activeTab()).toBe("details");
    root.querySelector<HTMLButtonElement>("[data-replay]")?.click();
    expect(activeTab()).toBe("step");
    expect(root.querySelector("[data-live-error]")?.textContent).toContain("boom");
  });
});
