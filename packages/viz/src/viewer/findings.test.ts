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
    payload: null,
    regions: {},
    effectMode: "real",
    waiting: [],
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
    expect(mark(root, "idle")?.getAttribute("aria-label")).toContain("pick in idle throws");
    expect(mark(root, "orphan")?.getAttribute("aria-label")).toContain(
      "orphan can never be reached",
    );
    expect(mark(root, "picked")).toBeNull();
  });

  test("a naming note on a state draws no mark", () => {
    // `idle` is a vague name (a note) and also has the handler error: only the error counts
    expect(mark(mount(), "idle")?.getAttribute("aria-label")).not.toContain("vague");
    const clean: VizMachine = {
      ...machine,
      states: machine.states.filter((candidate) => candidate.id !== "orphan"),
      fuzz: { ...machine.fuzz!, errors: [] },
    };
    expect(mark(mount(undefined, clean), "idle")).toBeNull();
  });

  test("clicking a mark opens the details without taking the step", () => {
    const root = mount();
    // idle is the current state and `picked` its next step; marks sit on `idle`, so click via picked's neighbour
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("idle");
    const finding = root.querySelector('.state-findings .finding[data-kind="handlerError"]');
    expect(finding?.querySelector("h4")?.textContent).toBe("pick in idle throws");
    expect(finding?.textContent).toContain("Fuzzing sent pick in idle and the handler threw");
    expect(finding?.querySelector(".finding-fix")?.textContent).toContain("Fix: ");
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
    expect(finding?.textContent).toContain("idle was never reached with");
    expect(finding?.textContent).toContain("No run got there, so there is nothing to replay.");
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
    expect(root.querySelector(".finding-no-replay")?.textContent).toBe(
      "Nothing reaches orphan, so there is nothing to replay.",
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

  test("a replay button is labelled for what it shows", () => {
    const root = mount(driver());
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector("[data-replay]")?.textContent).toBe("Replay the throw");
  });

  test("a finding mark brings the card into focus; the state chip does not", () => {
    const root = mount();
    document.body.append(root);
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    const heading = root.querySelector(".state-findings h4");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(root.querySelector(".finding-mark")?.getAttribute("data-state")).toBe("idle");
    const other = mount();
    document.body.append(other);
    other
      .querySelector("[data-node-id=orphan]")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.activeElement).not.toBe(other.querySelector(".state-findings h4"));
  });
});

const wide: VizMachine = {
  ...machine,
  states: [state("idle", { initial: true }), state("picked")],
  fuzz: null,
  events: [
    { id: "pick", internal: false, doc: null, payload: null },
    { id: "ghost", internal: false, doc: "x", payload: null },
  ],
};

describe("machine-wide findings and notes", () => {
  test("an event nobody handles shows under About the whole machine, with and without selection", () => {
    const root = mount(undefined, wide);
    const section = () => root.querySelector(".machine-findings");
    expect(section()?.getAttribute("data-findings")).toBe("1");
    expect(section()?.textContent).toContain("ghost is declared but no state handles it");
    expect(section()?.querySelector("[data-replay]")).toBeNull();
    expect(section()?.querySelector(".finding-no-replay")?.textContent).toBe(
      "No state handles ghost, so there is nothing to replay.",
    );
    mark(root, "idle")?.dispatchEvent(new Event("click", { bubbles: true }));
    root
      .querySelector("[data-node-id=picked]")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(section()).not.toBeNull();
  });

  test("a naming note on a state has no mark and sits under Naming notes", () => {
    const root = mount(undefined, wide);
    expect(root.querySelector(".finding-mark")).toBeNull();
    root.querySelector("[data-node-id=idle]")?.dispatchEvent(new Event("click", { bubbles: true }));
    const notes = root.querySelector(".state-notes");
    expect(notes?.getAttribute("data-notes")).not.toBeNull();
    expect(notes?.querySelector("article[data-note]")).not.toBeNull();
    expect(root.querySelector(".state-findings")).toBeNull();
  });

  test("no card uses a generic title", () => {
    const root = mount(driver());
    for (const id of ["idle", "orphan"]) {
      mark(root, id)?.dispatchEvent(new Event("click", { bubbles: true }));
    }
    for (const old of [
      "Handler throws",
      "Dead end",
      "Unreachable state",
      "Vague name",
      "No description",
    ]) {
      expect(root.textContent).not.toContain(old);
    }
  });
});
