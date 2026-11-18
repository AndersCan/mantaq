// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";

const stateOf = (id: string): VizState => ({
  id,
  label: id,
  region: null,
  initial: id === "idle",
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edgeOf = (from: string, event: string, to: string): VizEdge => ({
  id: `${from}-${event}-${to}`,
  from,
  event,
  to,
  kind: "transition",
  origin: "declared",
  emits: [],
  contexts: [],
  explanation: null,
  doc: "Goes home.",
  coverage: null,
  tested: null,
});

/** idle -begin-> a; a, b and c each -go-> home. */
const machine: VizMachine = {
  id: "m",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: ["idle", "a", "b", "c", "home"].map(stateOf),
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    edgeOf("idle", "begin", "a"),
    ...["a", "b", "c"].map((from) => edgeOf(from, "go", "home")),
  ],
  fuzz: null,
  runs: [],
};

function fakeDriver(blocking = false) {
  const sent: VizStep[] = [];
  const liveAt = (steps: ReadonlyArray<VizStep>): VizLiveState => {
    const events = steps.map((step) => (step.kind === "event" ? step.event : ""));
    const state = events.includes("go") ? "home" : events.includes("begin") ? "a" : "idle";
    return {
      state,
      steps: [...steps],
      last: null,
      after: [],
      timers: [],
      context: {},
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
    };
  };
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return liveAt([]);
    },
    step: (step) => {
      sent.push(step);
      return liveAt(sent);
    },
    listen: () => {},
    dryRun: (candidates) =>
      candidates.map((step) =>
        blocking && step.kind === "event" && step.event === "go"
          ? {
              from: "a",
              event: "go",
              to: "idle",
              outcome: "transition",
              effects: [],
              sent: [],
              context: {},
              error: null,
            }
          : null,
      ),
  };
  return { driver, sent };
}

function mount(drawn: VizMachine = machine, blocking = false) {
  const { driver, sent } = fakeDriver(blocking);
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [drawn] }, { driver });
  return { root, sent };
}

const shared = (root: HTMLElement) => root.querySelector<SVGElement>("g.edge[data-members]");
const press = (element: Element | null) =>
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const details = (root: HTMLElement) => root.querySelector(".details");

describe("an arrow three states share", () => {
  test("is drawn once, from a node naming its states", () => {
    const { root } = mount();
    expect(root.querySelectorAll("g.edge[data-edge-id]")).toHaveLength(2);
    expect(shared(root)?.getAttribute("data-members")).toBe(
      JSON.stringify(["a-go-home", "b-go-home", "c-go-home"]),
    );
    expect(shared(root)?.getAttribute("aria-label")).toBe("3 states on go to home");
    expect(root.querySelector("g.any-node text")?.textContent).toBe("a, b, c");
    expect(root.querySelector("g.any-node")?.getAttribute("aria-label")).toBe(
      "these 3 states: a, b, c",
    );
  });

  test("from another state, a click opens the details listing every source", () => {
    const { root, sent } = mount();
    press(shared(root));
    expect(sent).toHaveLength(0);
    expect(details(root)?.querySelector("h2")?.textContent).toBe("3 states —go→ home");
    expect(
      [...root.querySelectorAll("[data-edge-link]")].map((link) =>
        link.getAttribute("data-edge-link"),
      ),
    ).toEqual(["a-go-home", "b-go-home", "c-go-home"]);
    press(root.querySelector('[data-edge-link="b-go-home"]'));
    expect(details(root)?.getAttribute("data-selected-edge")).toBe("b-go-home");
    expect(root.querySelector('[data-send-edge="b-go-home"]')).toBeNull();
  });

  test("from a source state, a click sends that member's event", () => {
    const { root, sent } = mount();
    expect(shared(root)?.classList.contains("next")).toBe(false);
    press(root.querySelector('g.edge[data-edge-id="idle-begin-a"]'));
    expect(shared(root)?.classList.contains("next")).toBe(true);
    expect(root.querySelector("g.any-node")?.classList.contains("current")).toBe(true);
    press(shared(root));
    expect(sent.map((step) => (step.kind === "event" ? step.event : ""))).toEqual(["begin", "go"]);
  });

  test("the member that is blocked from the current state locks the shared arrow", () => {
    const { root } = mount(machine, true);
    expect(shared(root)?.classList.contains("blocked")).toBe(false);
    press(root.querySelector('g.edge[data-edge-id="idle-begin-a"]'));
    expect(shared(root)?.classList.contains("blocked")).toBe(true);
  });

  test("the details show the first member's doc line", () => {
    const { root } = mount();
    press(shared(root));
    expect(root.querySelector('[data-doc="edge"]')?.textContent).toBe("Goes home.");
  });

  test("a node for every non-final state reads `any state`; an onAny node keeps its own name", () => {
    const every = {
      ...machine,
      states: ["a", "b", "c", "home"].map((id) => ({ ...stateOf(id), final: id === "home" })),
      edges: ["a", "b", "c"].map((from) => edgeOf(from, "go", "home")),
    };
    expect(mount(every).root.querySelector("g.any-node")?.getAttribute("aria-label")).toBe(
      "any state",
    );
    const onAny = { ...machine, edges: [edgeOf("*", "reset", "idle")] };
    expect(mount(onAny).root.querySelector("g.any-node")?.getAttribute("aria-label")).toBe(
      "any non-final state (onAny handlers)",
    );
  });

  test("`?` from a source state opens that member's Details; its Send returns focus to the shared arrow", () => {
    const { root, sent } = mount();
    press(root.querySelector('g.edge[data-edge-id="idle-begin-a"]'));
    press(root.querySelector("g.edge-help[data-members]"));
    expect(details(root)?.getAttribute("data-selected-edge")).toBe("a-go-home");
    press(root.querySelector('[data-send-edge="a-go-home"]'));
    expect(sent).toHaveLength(2);
    expect(document.activeElement).toBe(shared(root));
  });

  test("selecting a member marks the shared arrow", () => {
    const { root } = mount();
    press(shared(root));
    press(root.querySelector('[data-edge-link="c-go-home"]'));
    expect(shared(root)?.classList.contains("selected")).toBe(true);
  });

  test("selecting a member marks the node naming its states", () => {
    const { root } = mount();
    press(shared(root));
    press(root.querySelector('[data-edge-link="c-go-home"]'));
    expect(root.querySelector("g.any-node")?.classList.contains("selected")).toBe(true);
    expect(
      root.querySelector('g.edge[data-edge-id="idle-begin-a"]')?.classList.contains("selected"),
    ).toBe(false);
    press(root.querySelector('g.edge[data-edge-id="idle-begin-a"]'));
    expect(root.querySelector("g.any-node")?.classList.contains("selected")).toBe(false);
  });
});
