// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { serializeViz } from "../serialize.ts";
import { mountViewer, mountVizText } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: flags.initial ?? false,
    final: flags.final ?? false,
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
    kind: from === "__initial__" ? "initial" : "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

/** Hand-built so this package's tests need no machine: `open -go-> done`. */
const door: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
  maps: [],
  actors: [],
  states: [
    { ...state("open", { initial: true }), doc: "The door stands open." },
    state("done", { final: true }),
  ],
  events: [{ id: "go", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    edge("__initial__", "", "open"),
    { ...edge("open", "go", "done"), doc: "Walk through and close up." },
  ],
  fuzz: null,
  runs: [],
};

function mount(text: string): HTMLElement {
  const root = document.createElement("div");
  mountVizText(root, { source: "door.json", text });
  return root;
}

describe("mountVizText", () => {
  test("the panel shows the doc of the current state and of each next step", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelector('.panel [data-doc="state"]')?.textContent).toBe(
      "The door stands open.",
    );
    expect(
      root.querySelector('.panel [data-move="open-go-done"] [data-doc="edge"]')?.textContent,
    ).toBe("Walk through and close up.");
    root.querySelector<HTMLButtonElement>('[data-take="open-go-done"]')?.click();
    expect(root.querySelector('.panel [data-doc="state"]')).toBeNull();
  });

  test("internal and stay edges carry a dot gap variable and never an inline dasharray", () => {
    const machine: VizMachine = {
      ...door,
      events: [{ id: "go", internal: true, doc: null, payload: null }],
      edges: [
        edge("__initial__", "", "open"),
        edge("open", "go", "done"),
        { ...edge("open", "stay", "open"), kind: "stay" },
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    const paths = root.querySelectorAll<SVGPathElement>(".graph g.edge path:not(.hit)");
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(path.getAttribute("style")).toMatch(/^--viz-dot-gap: \d+(\.\d)?$/);
      expect(path.getAttribute("style")).not.toContain("stroke-dasharray");
    }
    const plain = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(plain.querySelector(".graph g.edge path")?.hasAttribute("style")).toBe(false);
  });

  test("a self-loop uses the loop arrowhead", () => {
    const machine: VizMachine = {
      ...door,
      edges: [
        edge("__initial__", "", "open"),
        edge("open", "go", "done"),
        { ...edge("open", "stay", "open"), kind: "stay" },
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    const markerOf = (id: string) =>
      root.querySelector(`[data-edge-id="${id}"] path:not(.hit)`)?.getAttribute("marker-end");
    expect(markerOf("open-stay-open")).toBe("url(#viz-arrow-loop)");
    expect(markerOf("open-go-done")).toBe("url(#viz-arrow)");
    const loopMarker = root.querySelector("#viz-arrow-loop");
    expect(loopMarker?.getAttribute("markerUnits")).toBe("userSpaceOnUse");
    expect(loopMarker?.getAttribute("markerWidth")).toBe("8");
    expect(loopMarker?.getAttribute("markerHeight")).toBe("8");
    expect(loopMarker?.querySelector("path")?.getAttribute("class")).toContain("arrow-head-loop");
  });

  test("a walk without a driver lists its moves at once, in no fold", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelector(".panel details")).toBeNull();
    expect(root.querySelectorAll(".panel [data-take]").length).toBeGreaterThan(0);
  });

  test("no diagram click takes a step", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    const before = root.querySelector(".explore")?.getAttribute("data-current");
    const targets = [...root.querySelectorAll(".graph [data-edge-id], .graph [data-node-id]")];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe(before);
      expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    }
  });

  test("draws a valid document and walks it to Done", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelectorAll(".graph g[data-node-id]")).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[data-take="open-go-done"]')?.click();
    expect(root.querySelector(".panel section.explore[data-done]")?.textContent).toContain(
      "In done (final)",
    );
    expect(root.querySelectorAll(".panel [data-take]")).toHaveLength(0);
  });
});

function fakeDriver(): VizDriver {
  const live = (state: string, steps: VizStep[], last: VizLiveState["last"]): VizLiveState => ({
    state,
    steps,
    last,
    after: [],
    timers: [],
    context: { n: steps.length },
    payload: null,
    regions: {},
    children: [],
    effectMode: "real",
    waiting: [],
  });
  const run = (steps: VizStep[]): VizLiveState => {
    let current = live("open", [], null);
    const done: VizStep[] = [];
    for (const step of steps) {
      done.push(step);
      const from = current.state;
      const event = step.kind === "event" ? step.event : "advance";
      if (event === "go" && from === "open") {
        current = live("done", [...done], {
          from,
          event,
          to: "done",
          outcome: "transition",
          effects: ["closeUp"],
          sent: [],
          context: { n: done.length },
          error: null,
        });
      } else if (event === "peek") {
        current = live(from, [...done], {
          from,
          event,
          to: from,
          outcome: "stay",
          effects: [],
          sent: [],
          context: { n: done.length },
          error: null,
        });
      } else if (event === "boom") {
        current = live("open", [...done], {
          from,
          event,
          to: "open",
          outcome: "stay",
          effects: [],
          sent: [],
          context: { n: done.length },
          error: "handler failed",
        });
      } else {
        current = live(from, [...done], {
          from,
          event,
          to: from,
          outcome: "ignored",
          effects: [],
          sent: [],
          context: { n: done.length },
          error: null,
        });
      }
    }
    return current;
  };
  let log: VizStep[] = [];
  return {
    reset: () => {
      log = [];
      return run(log);
    },
    step: (step) => {
      log = [...log, step];
      return run(log);
    },
  };
}

describe("mountViewer with a driver", () => {
  const withEvents: VizMachine = {
    ...door,
    events: [
      ...door.events,
      { id: "peek", internal: false, doc: null, payload: null },
      { id: "boom", internal: false, doc: null, payload: null },
      { id: "idle", internal: false, doc: null, payload: null },
    ],
  };
  const mountLive = (): HTMLElement => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEvents] },
      {
        driver: fakeDriver(),
      },
    );
    return root;
  };
  const send = (root: HTMLElement, event: string) =>
    root.querySelector<HTMLButtonElement>(`[data-send="${event}"]`)?.click();

  test("shows inputs with no handler as ignored", () => {
    const root = mountLive();
    expect(root.querySelector('[data-send-item="go"] [data-ignored]')).toBeNull();
    expect(root.querySelector('[data-send-item="peek"] [data-ignored]')?.textContent).toBe(
      " ignored in open",
    );
  });

  test("a transition moves the cursor and lists the effects run", () => {
    const root = mountLive();
    send(root, "go");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
    expect(root.querySelector('[data-outcome="transition"]')?.textContent).toContain("open → done");
    expect(root.querySelector("[data-live-effects]")?.textContent).toBe("Effects started: closeUp");
    expect(root.querySelector(".graph g[data-node-id='done']")?.classList).toContain("current");
  });

  test("the panel is tabbed: Step, then Details", () => {
    const root = mountLive();
    const labels = () => [...root.querySelectorAll("[data-tab]")].map((tab) => tab.textContent);
    const shown = () =>
      [...root.querySelectorAll("[data-tab-panel]")]
        .filter((panel) => !panel.hasAttribute("hidden"))
        .map((panel) => panel.getAttribute("data-tab-panel"));
    expect(labels()).toEqual(["Step", "Details"]);
    expect(shown()).toEqual(["step"]);
    send(root, "go");
    root.querySelector<HTMLButtonElement>('[data-tab="details"]')?.click();
    expect(shown()).toEqual(["details"]);
    expect(root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
  });

  test("selecting an element that is not a next step opens Details", () => {
    const root = mountLive();
    root
      .querySelector("[data-node-id='open']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector('[data-tab-panel="details"]')?.hasAttribute("hidden")).toBe(false);
  });

  test("stay and ignored outcomes keep the cursor", () => {
    const root = mountLive();
    send(root, "peek");
    expect(root.querySelector('[data-outcome="stay"]')?.textContent).toContain("stays");
    send(root, "idle");
    expect(root.querySelector('[data-outcome="ignored"]')?.textContent).toContain("Nothing ran.");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
  });

  test("a handler error is shown", () => {
    const root = mountLive();
    send(root, "boom");
    expect(root.querySelector("[data-live-error]")?.textContent).toBe(
      "Handler threw: handler failed",
    );
  });

  test("back and reset replay the log through the driver", () => {
    const root = mountLive();
    send(root, "peek");
    send(root, "go");
    root.querySelector<HTMLButtonElement>('[data-explore-action="back"]')?.click();
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
    root.querySelector<HTMLButtonElement>('[data-explore-action="reset"]')?.click();
    expect(root.querySelector("[data-outcome]")).toBeNull();
  });

  test("hides the machine picker and ignores ?step= in live mode", () => {
    const root = document.createElement("div");
    const other = { ...withEvents, id: "other" };
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEvents, other] },
      { driver: fakeDriver(), steps: ["x"] },
    );
    expect(root.querySelector(".machine-select")).toBeNull();
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
  });

  test("a driver that throws shows the error and keeps the state", () => {
    const root = document.createElement("div");
    const inner = fakeDriver();
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEvents] },
      {
        driver: {
          reset: () => inner.reset(),
          step: (step) => {
            if (step.kind === "event" && step.event === "peek") throw new Error("driver down");
            return inner.step(step);
          },
        },
      },
    );
    send(root, "peek");
    expect(root.querySelector("[data-live-error]")?.textContent).toBe("Handler threw: driver down");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
  });

  test("a link with a step the driver throws on still mounts", () => {
    const root = document.createElement("div");
    const inner = fakeDriver();
    const mount = () =>
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEvents] },
        {
          driver: {
            reset: () => inner.reset(),
            step: (step) => {
              if (step.kind === "event" && step.event === "boom") throw new Error("x");
              return inner.step(step);
            },
          },
          steps: ["boom"],
        },
      );
    expect(mount).not.toThrow();
    expect(root.querySelector("[data-live-error]")?.textContent).toBe("Handler threw: x");
  });
});

describe("walking: the selected arrow's Send", () => {
  test("an arrow whose target depends on the payload has no button", () => {
    const dynamic: VizMachine = {
      ...door,
      edges: [...door.edges, { ...edge("open", "dyn", "done"), to: null }],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [dynamic] }));
    root
      .querySelector('[data-edge-id="open-dyn-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-selected-edge]")).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
    expect(root.querySelector("[data-selected-edge] > div:empty")).toBeNull();
  });

  test("an arrow with several targets has a Send per target, each taking its own step", () => {
    const push: VizEdge = {
      ...edge("open", "push", "ajar"),
      to: null,
      explanation: {
        status: "analyzed",
        location: { file: "door.ts", line: 1, column: 1 },
        registration: "on",
        branches: [
          { conditions: ["hard"], target: { kind: "state", state: "done" } },
          { conditions: ["!(hard)"], target: { kind: "state", state: "ajar" } },
        ],
        payloadReads: [],
        contextReads: [],
        contextWrites: [],
        readsActorState: false,
        comparisons: [],
        literals: [],
      },
    };
    const pushy: VizMachine = {
      ...door,
      states: [...door.states, state("ajar", { final: true })],
      events: [...door.events, { id: "push", internal: false, doc: null, payload: null }],
      edges: [...door.edges, push],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [pushy] }));
    root
      .querySelector('[data-edge-id="open-push-ajar"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const sends = [...root.querySelectorAll<HTMLButtonElement>("[data-send-edge]")];
    expect(sends.map((each) => each.textContent)).toEqual(["Send push → ajar", "Send push → done"]);
    sends[1]?.click();
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
  });

  test("Step tab buttons start with Send", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelector('.panel [data-move="open-go-done"] button')?.textContent).toMatch(
      /^Send go/,
    );
  });

  test("a click selects, then Send takes the step", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    root
      .querySelector('[data-edge-id="open-go-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
    const send = root.querySelector<HTMLButtonElement>("[data-send-edge]");
    expect(send?.textContent).toBe("Send go");
    send?.click();
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
    expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("after a walking Send, the Details say where it went", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    root
      .querySelector('[data-edge-id="open-go-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(root.querySelector("[data-details-sent]")?.textContent).toBe("Sent go: open → done");
  });

  test("after a walking Send, focus is on the selected arrow", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    document.body.append(root);
    root
      .querySelector('[data-edge-id="open-go-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(document.activeElement?.getAttribute("data-edge-id")).toBe("open-go-done");
    root.remove();
  });
});

describe("effect chip", () => {
  test("is labelled with its effect name for keyboard users", () => {
    const withEffect: VizMachine = {
      ...door,
      states: door.states.map((each) =>
        each.id === "open" ? { ...each, effects: [{ name: "greet", sends: null }] } : each,
      ),
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEffect] }));
    expect(root.querySelector(".chip")?.getAttribute("aria-label")).toBe("effect greet");
    expect(root.querySelector(".chip .hint")).toBeNull();
  });
});
