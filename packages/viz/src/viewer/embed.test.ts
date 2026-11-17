// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizBranch,
  VizDriver,
  VizEdge,
  VizLiveState,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { serializeViz } from "../serialize.ts";
import { mountViewer, mountVizText } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";
import { sendVia } from "./send-via.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    expect(plain.querySelector(".graph g.edge path:not(.hit)")?.hasAttribute("style")).toBe(false);
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
    expect(markerOf("open-stay-open")).toBe("url(#viz-arrow)");
    expect(markerOf("open-go-done")).toBe("url(#viz-arrow)");
    expect(root.querySelector("#viz-arrow-loop")).toBeNull();
  });

  test("without a driver the panel is the Details tab only, with no Send", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    const ids = [...root.querySelectorAll("[data-tab]")].map((tab) => tab.getAttribute("data-tab"));
    expect(ids).toEqual(["details"]);
    expect(root.querySelector(".explore")).toBeNull();
    expect(root.querySelectorAll(".graph .current, .graph .next")).toHaveLength(0);
    root
      .querySelector('[data-edge-id="open-go-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-selected-edge]")).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("an arrow's title carries its condition and lists the other arrows of the event", () => {
    const branches: VizBranch[] = [
      { conditions: ['answer === "accepted"'], target: { kind: "state", state: "accepted" } },
      { conditions: ['!(answer === "accepted")'], target: { kind: "state", state: "declined" } },
    ];
    const explanation: VizEdge["explanation"] = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches,
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    const machine: VizMachine = {
      ...door,
      initial: "waiting",
      states: [
        state("waiting", { initial: true }),
        state("accepted", { final: true }),
        state("declined", { final: true }),
      ],
      events: [{ id: "answered", internal: false, doc: null, payload: null }],
      edges: [
        edge("__initial__", "", "waiting"),
        { ...edge("waiting", "answered", "accepted"), explanation },
        { ...edge("waiting", "answered", "declined"), explanation },
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    const click = (selector: string) =>
      root.querySelector(selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click('[data-edge-id="waiting-answered-declined"]');
    expect(root.querySelector(".details h2")?.textContent).toBe(
      "waiting —answered [else]→ declined",
    );
    const links = [...root.querySelectorAll('.details dd[data-field="same event"] .link')];
    expect(links.map((link) => link.textContent)).toEqual([
      'waiting —answered [answer === "accepted"]→ accepted',
    ]);
    click('.details [data-edge-link="waiting-answered-accepted"]');
    expect(root.querySelector(".details h2")?.textContent).toBe(
      'waiting —answered [answer === "accepted"]→ accepted',
    );
    click('[data-node-id="waiting"]');
    const outgoing = [...root.querySelectorAll('.details dd[data-field="outgoing"] .link')];
    expect(outgoing.map((link) => link.textContent)).toEqual([
      "waiting —answered→ accepted",
      "waiting —answered→ declined",
    ]);
  });

  test("same event lists siblings in source order, only this state's transitions of this event", () => {
    const branches: VizBranch[] = [
      { conditions: ["score < 600"], target: { kind: "state", state: "rejected" } },
      {
        conditions: ["!(score < 600)", "amount > 50000"],
        target: { kind: "state", state: "review" },
      },
      {
        conditions: ["!(score < 600)", "!(amount > 50000)"],
        target: { kind: "state", state: "approved" },
      },
    ];
    const explanation: VizEdge["explanation"] = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches,
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    const machine: VizMachine = {
      ...door,
      initial: "idle",
      states: [
        state("idle", { initial: true }),
        state("review"),
        state("approved", { final: true }),
        state("rejected", { final: true }),
      ],
      events: [
        { id: "apply", internal: false, doc: null, payload: null },
        { id: "reset", internal: false, doc: null, payload: null },
      ],
      edges: [
        edge("__initial__", "", "idle"),
        { ...edge("idle", "apply", "review"), explanation },
        { ...edge("idle", "apply", "approved"), explanation },
        { ...edge("idle", "apply", "rejected"), explanation },
        { ...edge("idle", "apply", "idle"), kind: "stay" },
        edge("idle", "reset", "approved"),
        edge("review", "apply", "rejected"),
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    root
      .querySelector('[data-edge-id="idle-apply-review"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const links = [...root.querySelectorAll('.details dd[data-field="same event"] .link')];
    expect(links.map((link) => link.textContent)).toEqual([
      "idle —apply [score < 600]→ rejected",
      "idle —apply [else]→ approved",
    ]);
  });

  test("same event inside a region lists siblings in source order", () => {
    const branches: VizBranch[] = [
      { conditions: ["score < 600"], target: { kind: "state", state: "rejected" } },
      {
        conditions: ["!(score < 600)", "amount > 50000"],
        target: { kind: "state", state: "review" },
      },
      {
        conditions: ["!(score < 600)", "!(amount > 50000)"],
        target: { kind: "state", state: "approved" },
      },
    ];
    const explanation: VizEdge["explanation"] = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches,
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    const inR = (id: string, flags: { initial?: boolean; final?: boolean } = {}) => ({
      ...state(`r.${id}`, flags),
      region: "r",
    });
    const machine: VizMachine = {
      ...door,
      initial: "idle",
      regions: ["r"],
      states: [
        state("idle", { initial: true }),
        inR("idle", { initial: true }),
        inR("review"),
        inR("approved"),
        inR("rejected"),
      ],
      events: [{ id: "apply", internal: false, doc: null, payload: null }],
      edges: [
        edge("__initial__", "", "idle"),
        { ...edge("r.idle", "apply", "r.review"), explanation },
        { ...edge("r.idle", "apply", "r.approved"), explanation },
        { ...edge("r.idle", "apply", "r.rejected"), explanation },
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    root
      .querySelector('[data-edge-id="r.idle-apply-r.review"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const links = [...root.querySelectorAll('.details dd[data-field="same event"] .link')];
    expect(links.map((link) => link.textContent)).toEqual([
      "r.idle —apply [score < 600]→ r.rejected",
      "r.idle —apply [else]→ r.approved",
    ]);
  });

  test("same event lists siblings no branch of this arrow reaches last, by target", () => {
    const explanation: VizEdge["explanation"] = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches: [
        { conditions: ["ok"], target: { kind: "state", state: "done" } },
        { conditions: ["!(ok)"], target: { kind: "state", state: "other" } },
      ],
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    };
    const machine: VizMachine = {
      ...door,
      initial: "idle",
      states: ["idle", "zeta", "alpha", "other", "done"].map((id) =>
        state(id, { initial: id === "idle" }),
      ),
      events: [{ id: "go", internal: false, doc: null, payload: null }],
      edges: [
        edge("__initial__", "", "idle"),
        edge("idle", "go", "zeta"),
        edge("idle", "go", "alpha"),
        { ...edge("idle", "go", "other"), explanation },
        { ...edge("idle", "go", "done"), explanation },
      ],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    root
      .querySelector('[data-edge-id="idle-go-done"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const links = [...root.querySelectorAll('.details dd[data-field="same event"] .link')];
    expect(links.map((link) => link.textContent)).toEqual([
      "idle —go [else]→ other",
      "idle —go→ alpha",
      "idle —go→ zeta",
    ]);
  });

  test("Details hold the title, the doc line and, for a state, only its links", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    const click = (selector: string) =>
      root.querySelector(selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click('[data-edge-id="open-go-done"]');
    const edgeTags = [...(root.querySelector(".details")?.children ?? [])].map((child) =>
      child.tagName.toLowerCase(),
    );
    expect(edgeTags).toEqual(["h2", "p"]);
    expect(root.querySelector('.details p[data-doc="edge"]')?.textContent).toBe(
      "Walk through and close up.",
    );
    expect(root.querySelector(".details dl")).toBeNull();
    click('[data-node-id="open"]');
    expect(root.querySelector('.details p[data-doc="state"]')?.textContent).toBe(
      "The door stands open.",
    );
    const labels = [...root.querySelectorAll(".details [data-field]")].map((dd) =>
      dd.getAttribute("data-field"),
    );
    expect(labels).toEqual(["outgoing", "incoming"]);
    click('.details [data-edge-link="open-go-done"]');
    expect(
      root.querySelector(".graph g.selected[data-edge-id]")?.getAttribute("data-edge-id"),
    ).toBe("open-go-done");
    click('[data-node-id="done"]');
    expect(root.querySelector(".details [data-doc]")).toBeNull();
  });

  test("a state's links are the drawn arrows, never an effect", () => {
    const file = join(import.meta.dirname, "reference", "docs-checkout.json");
    const machine = JSON.parse(readFileSync(file, "utf8")) as VizMachine;
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    root
      .querySelector('[data-node-id="submitting"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const links = [...root.querySelectorAll(".details [data-edge-link]")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const id = link.getAttribute("data-edge-link") ?? "";
      expect(root.querySelector(`.graph g[data-edge-id="${id}"]`)).not.toBeNull();
      expect(link.textContent).not.toContain("effect:");
    }
  });

  test("the start state's incoming links leave out the start arrow", () => {
    const file = join(import.meta.dirname, "reference", "docs-checkout.json");
    const machine = JSON.parse(readFileSync(file, "utf8")) as VizMachine;
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }));
    root
      .querySelector('[data-node-id="basicInfo"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ids = [...root.querySelectorAll(".details [data-edge-link]")].map((link) =>
      link.getAttribute("data-edge-link"),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain("__initial__->basicInfo");
    for (const id of ids) {
      expect(root.querySelector(`.graph g[data-edge-id="${id}"]`)).not.toBeNull();
    }
  });

  test("draws a valid document", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelectorAll(".graph g[data-node-id]")).toHaveLength(2);
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
    ],
    edges: [
      ...door.edges,
      { ...edge("open", "peek", "open"), kind: "stay" },
      { ...edge("open", "boom", "open"), kind: "stay" },
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
  const send = sendVia;

  test("a transition moves the cursor and lists the effects run", () => {
    const root = mountLive();
    send(root, "go");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
    expect(root.querySelector('[data-outcome="transition"]')?.textContent).toContain("open → done");
    expect(root.querySelector("[data-live-effects]")).toBeNull();
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

  test("a stay outcome keeps the cursor", () => {
    const root = mountLive();
    send(root, "peek");
    expect(root.querySelector('[data-outcome="stay"]')?.textContent).toContain("stays");
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

  test("ignores ?step= in live mode", () => {
    const root = document.createElement("div");
    const other = { ...withEvents, id: "other" };
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEvents, other] },
      { driver: fakeDriver(), steps: ["x"] },
    );
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
