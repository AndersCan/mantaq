// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

const ids = ["idle", "a", "b", "c", "d"];

function state(id: string): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: id === "idle",
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, to: string): VizEdge {
  return {
    id: `${from}-go-${to}`,
    from,
    event: "go",
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

const go: VizStep = { kind: "event", event: "go", payload: null };

const chain: VizMachine = {
  id: "chain",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: ids.map(state),
  events: [{ id: "go", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: ids.slice(0, -1).map((from, i) => edge(from, ids[i + 1] ?? from)),
  runs: [],
  // The one sequence goes through a, b, c and on to d; `d` is not listed as discovered.
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [{ steps: [go, go, go, go], discovered: ["state:a", "state:b", "state:c"] }],
    errors: [],
    failedExpectations: [],
    expectations: [],
  },
};

function driver(options: { dryWalk?: boolean } = {}): VizDriver {
  const done: VizStep[] = [];
  const run = (count = done.length): VizLiveState => ({
    state: ids[Math.min(count, ids.length - 1)] ?? "idle",
    steps: done.slice(0, count),
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children: [],
    effectMode: "real",
    waiting: [],
  });
  return {
    reset: () => {
      done.length = 0;
      return run();
    },
    step: (step) => {
      done.push(step);
      return run();
    },
    ...(options.dryWalk === false
      ? {}
      : {
          dryWalk: (steps: ReadonlyArray<VizStep>) =>
            [0, ...steps.map((_, i) => i + 1)].map((n) => run(n)),
        }),
  };
}

function mount(
  options: {
    screen?: boolean;
    live?: boolean;
    dryWalk?: boolean;
    onNavigate?: (w: { steps: string[] }) => void;
  } = {},
) {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [chain] },
    {
      ...(options.live === false ? {} : { driver: driver({ dryWalk: options.dryWalk ?? true }) }),
      ...(options.screen === false
        ? {}
        : {
            screen: (live: VizLiveState) => {
              const node = document.createElement("p");
              node.className = "drawn";
              node.textContent = `screen of ${live.state}`;
              return node;
            },
          }),
      ...(options.onNavigate === undefined ? {} : { onNavigate: options.onNavigate }),
    },
  );
  return root;
}

const clickState = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-node-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const tabIds = (root: HTMLElement) =>
  [...root.querySelectorAll("[role=tab]")].map((tab) => tab.textContent);
const drawn = (root: HTMLElement) => root.querySelector(".drawn")?.textContent;
const screenShown = (root: HTMLElement) =>
  root.querySelector("[data-tab-panel=screen]")?.hasAttribute("hidden") === false;
const note = (root: HTMLElement) =>
  root.querySelector("[data-screen-of]")?.textContent ?? undefined;
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

describe("Screen tab", () => {
  test("is the first tab, open, and holds what screen returned for the state", () => {
    const root = mount();
    expect(tabIds(root)[0]).toBe("Screen");
    expect(tabIds(root)[1]).toBe("Step");
    expect(drawn(root)).toBe("screen of idle");
  });

  test("a click on a state with Screen open shows that state's screen and does not walk", () => {
    const navigated: string[][] = [];
    const root = mount({ onNavigate: (where) => navigated.push(where.steps) });
    const calls = navigated.length;
    for (const id of ["a", "c"]) {
      clickState(root, id);
      expect(screenShown(root)).toBe(true);
      expect(drawn(root)).toBe(`screen of ${id}`);
      expect(note(root)).toBe(`This is ${id}; the machine is still in idle.`);
      expect(current(root)).toBe("idle");
    }
    expect(navigated).toHaveLength(calls);
  });

  test("a state no corpus walk reaches shows the live screen and says so", () => {
    const root = mount();
    clickState(root, "d");
    expect(drawn(root)).toBe("screen of idle");
    expect(note(root)).toBe("No known walk reaches d; this is idle.");
  });

  test("a driver without dryWalk gives the same note", () => {
    const root = mount({ dryWalk: false });
    clickState(root, "a");
    expect(drawn(root)).toBe("screen of idle");
    expect(note(root)).toBe("No known walk reaches a; this is idle.");
  });

  test("selecting the live state shows its screen with no note", () => {
    const root = mount();
    clickState(root, "c");
    clickState(root, "idle");
    expect(drawn(root)).toBe("screen of idle");
    expect(note(root)).toBeUndefined();
  });

  test("a region state with Screen open shows the live screen with no note", () => {
    const withRegion: VizMachine = {
      ...chain,
      regions: ["r"],
      states: [...chain.states, { ...state("r.x"), region: "r", initial: false }],
      fuzz:
        chain.fuzz === null || chain.fuzz === undefined
          ? chain.fuzz
          : { ...chain.fuzz, corpus: [{ steps: [go], discovered: ["state:r.x"] }] },
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRegion] },
      {
        driver: driver(),
        screen: (live: VizLiveState) => {
          const node = document.createElement("p");
          node.className = "drawn";
          node.textContent = `screen of ${live.state}`;
          return node;
        },
      },
    );
    clickState(root, "r.x");
    expect(screenShown(root)).toBe(true);
    expect(drawn(root)).toBe("screen of idle");
    expect(note(root)).toBeUndefined();
  });

  test("an arrow's ? with Screen open opens Details", () => {
    const root = mount();
    root
      .querySelector('[data-details-edge="idle-go-a"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(screenShown(root)).toBe(false);
    expect(root.querySelector("[data-tab-panel=details]")?.hasAttribute("hidden")).toBe(false);
  });

  test("a state off the Screen tab opens its details, as before", () => {
    const root = mount();
    root.querySelectorAll<HTMLElement>("[role=tab]")[1]?.click();
    clickState(root, "c");
    expect(screenShown(root)).toBe(false);
    expect(current(root)).toBe("idle");
    expect(root.querySelector("[data-tab-panel=details]")?.hasAttribute("hidden")).toBe(false);
  });
});

describe("without a screen or a driver", () => {
  test("no screen: no Screen tab", () => {
    expect(tabIds(mount({ screen: false }))).not.toContain("Screen");
  });

  test("no driver: no Screen tab", () => {
    const root = mount({ live: false });
    expect(tabIds(root)).not.toContain("Screen");
    expect(drawn(root)).toBeUndefined();
  });
});
