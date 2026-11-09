// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { serializeViz } from "../serialize.ts";
import { clickStep } from "./explore.ts";
import { mountViewer, mountVizText } from "./embed.ts";
import type { ViewerSelection } from "./embed.ts";
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
  states: [
    { ...state("open", { initial: true }), doc: "The door stands open." },
    state("done", { final: true }),
  ],
  events: [{ id: "go", internal: false, doc: null, payload: null }],
  outputs: [],
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

  test("without a driver there is no Runs section", () => {
    const withRuns: VizMachine = {
      ...door,
      runs: [{ name: "goes", steps: [{ kind: "event", event: "go", payload: null }] }],
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns] }));
    expect(root.querySelector("[data-runs]")).toBeNull();
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
    const paths = root.querySelectorAll<SVGPathElement>(".graph g.edge path");
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(path.getAttribute("style")).toMatch(/^--viz-dot-gap: \d+(\.\d)?$/);
      expect(path.getAttribute("style")).not.toContain("stroke-dasharray");
    }
    const plain = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(plain.querySelector(".graph g.edge path")?.hasAttribute("style")).toBe(false);
  });

  test("a self-loop uses the small arrowhead", () => {
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
      root.querySelector(`[data-edge-id="${id}"] path`)?.getAttribute("marker-end");
    expect(markerOf("open-stay-open")).toBe("url(#viz-arrow-loop)");
    expect(markerOf("open-go-done")).toBe("url(#viz-arrow)");
    const loopMarker = root.querySelector("#viz-arrow-loop");
    expect(loopMarker?.getAttribute("markerUnits")).toBe("userSpaceOnUse");
    expect(loopMarker?.getAttribute("markerWidth")).toBe("6");
    expect(loopMarker?.getAttribute("markerHeight")).toBe("6");
    expect(loopMarker?.querySelector("path")?.getAttribute("class")).toContain("arrow-head-loop");
  });

  test("a walk without a driver keeps its moves inside the Events and time fold", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelector(".panel details[data-events] summary")?.textContent).toBe(
      "Events and time",
    );
    expect(root.querySelectorAll(".panel details[data-events] [data-take]").length).toBeGreaterThan(
      0,
    );
    expect(root.querySelectorAll(".panel [data-take]")).toHaveLength(
      root.querySelectorAll(".panel details[data-events] [data-take]").length,
    );
  });

  test("draws a valid document and walks it to Done", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [door] }));
    expect(root.querySelectorAll(".graph g[data-node-id]")).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[data-take="open-go-done"]')?.click();
    expect(root.querySelector(".panel section.explore[data-done]")?.textContent).toContain(
      "In done (final)",
    );
    expect(root.querySelector(".panel details[data-events]")).toBeNull();
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
    expect(root.querySelector("[data-live-context]")?.textContent).toBe('{\n  "n": 1\n}');
    expect(root.querySelector(".graph g[data-node-id='done']")?.classList).toContain("current");
  });

  test("the panel is tabbed and the Context tab counts changed lines", () => {
    const root = mountLive();
    const labels = () => [...root.querySelectorAll("[data-tab]")].map((tab) => tab.textContent);
    const shown = () =>
      [...root.querySelectorAll("[data-tab-panel]")]
        .filter((panel) => !panel.hasAttribute("hidden"))
        .map((panel) => panel.getAttribute("data-tab-panel"));
    expect(labels()).toEqual(["Step", "Context", "Path", "Details"]);
    expect(shown()).toEqual(["step"]);
    send(root, "go");
    expect(labels()[1]).toBe("Context (1 changed)");
    root.querySelector<HTMLButtonElement>('[data-tab="context"]')?.click();
    expect(shown()).toEqual(["context"]);
    expect(root.querySelector('[data-tab="context"]')?.getAttribute("aria-selected")).toBe("true");
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
    expect(root.querySelectorAll("[data-rewind]")).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[data-explore-action="reset"]')?.click();
    expect(root.querySelector("[data-outcome]")).toBeNull();
  });

  test("ArrowLeft steps back one live step", () => {
    const root = mountLive();
    send(root, "peek");
    send(root, "peek");
    send(root, "go");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(root.querySelectorAll("[data-rewind]")).toHaveLength(3);
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("open");
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

  test("a graph click is resolved from the live state", () => {
    const selection = { kind: "state", id: "done" } as const;
    expect(clickStep(withEvents, { path: [], selection })).not.toBeNull();
    expect(clickStep(withEvents, { path: [], selection, currents: ["done"] })).toBeNull();
  });
});

describe("effect chip hover", () => {
  const withEffect: VizMachine = {
    ...door,
    states: door.states.map((each) =>
      each.id === "open" ? { ...each, effects: [{ name: "greet", sends: ["go"] }] } : each,
    ),
  };

  test("hovering a chip highlights the edges it sends, labels them and dims the rest", () => {
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEffect] }));
    const chip = root.querySelector(".chip");
    const sent = root.querySelector('[data-edge-id="open-go-done"]');
    expect(sent?.querySelector("title")?.textContent).toBe("emitted by greet");
    chip?.dispatchEvent(new Event("mouseenter"));
    expect(sent?.classList.contains("sent")).toBe(true);
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(true);
    chip?.dispatchEvent(new Event("mouseleave"));
    expect(sent?.classList.contains("sent")).toBe(false);
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(false);
  });

  test("a chip without declared sends changes nothing", () => {
    const none = {
      ...withEffect,
      states: withEffect.states.map((each) => ({
        ...each,
        effects: each.effects.map((effect) => ({ ...effect, sends: null })),
      })),
    };
    const root = mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [none] }));
    root.querySelector(".chip")?.dispatchEvent(new Event("mouseenter"));
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(false);
  });
});

describe("effect chip hover edge cases", () => {
  const anyMachine: VizMachine = {
    ...door,
    states: [
      {
        ...state("open", { initial: true }),
        effects: [
          { name: "greet", sends: ["go"] },
          { name: "wave", sends: ["go"] },
          { name: "lost", sends: ["nothing"] },
        ],
      },
      state("done", { final: true }),
    ],
    events: [
      { id: "go", internal: true, doc: null, payload: null },
      { id: "nothing", internal: true, doc: null, payload: null },
    ],
    edges: [edge("__initial__", "", "open"), edge("*", "go", "done")],
  };
  const build = () =>
    mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [anyMachine] }));
  const chipOf = (root: HTMLElement, name: string) =>
    root.querySelector(`.chip[data-effect="${name}"]`);

  test("an onAny handler for a sent event is highlighted and names every emitter", () => {
    const root = build();
    const sent = root.querySelector('[data-edge-id="*-go-done"]');
    expect(sent?.querySelector("title")?.textContent).toBe("emitted by greet, wave");
    chipOf(root, "greet")?.dispatchEvent(new Event("mouseenter"));
    expect(sent?.classList.contains("sent")).toBe(true);
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(true);
  });

  test("focus and blur toggle the highlight", () => {
    const root = build();
    const sent = root.querySelector('[data-edge-id="*-go-done"]');
    chipOf(root, "wave")?.dispatchEvent(new Event("focusin"));
    expect(sent?.classList.contains("sent")).toBe(true);
    chipOf(root, "wave")?.dispatchEvent(new Event("focusout"));
    expect(sent?.classList.contains("sent")).toBe(false);
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(false);
  });

  test("a sent event with no edge changes nothing", () => {
    const root = build();
    chipOf(root, "lost")?.dispatchEvent(new Event("mouseenter"));
    expect(root.querySelector(".graph")?.classList.contains("chip-active")).toBe(false);
    expect(root.querySelector(".sent")).toBeNull();
  });
});

describe("effect chip sends hint", () => {
  const withEffect = (sends: string[] | null): VizMachine => ({
    ...door,
    states: door.states.map((each) =>
      each.id === "open" ? { ...each, effects: [{ name: "announcement", sends }] } : each,
    ),
  });
  const render = (sends: string[] | null) =>
    mount(serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEffect(sends)] }));

  test("an effect without declared sends shows a ? with the hint", () => {
    const hint = render(null).querySelector(".chip .hint");
    expect(hint?.textContent).toContain("?");
    expect(hint?.querySelector("title")?.textContent).toBe("declare `sends` to see links");
  });

  test("the chip reserves room for the hint and is labelled for keyboard users", () => {
    const chipWidth = (sends: string[] | null) =>
      Number(render(sends).querySelector(".chip rect")?.getAttribute("width"));
    expect(chipWidth(null)).toBeGreaterThan(chipWidth(["go"]));
    expect(render(null).querySelector(".chip")?.getAttribute("aria-label")).toContain(
      "declare sends",
    );
  });

  test("declared sends, including an empty list, show no hint", () => {
    expect(render(["go"]).querySelector(".chip .hint")).toBeNull();
    expect(render([]).querySelector(".chip .hint")).toBeNull();
  });
});

describe("panelFooter", () => {
  const three: VizMachine = {
    ...door,
    states: [state("open", { initial: true }), state("done"), state("end", { final: true })],
    edges: [
      edge("__initial__", "", "open"),
      edge("open", "go", "done"),
      edge("open", "skip", "end"),
      edge("done", "go", "end"),
    ],
  };
  const live = (calls: Array<ViewerSelection | undefined>, node: Node) => {
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [three] },
      {
        panelFooter: (selection) => {
          calls.push(selection);
          return node;
        },
      },
    );
    return root;
  };
  const footer = () => {
    const f = document.createElement("div");
    f.id = "f";
    return f;
  };
  const click = (root: HTMLElement, id: string) =>
    root
      .querySelector(`[data-node-id='${id}']`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  test("the footer renders under the tabs with no selection", () => {
    const calls: Array<ViewerSelection | undefined> = [];
    const root = live(calls, footer());
    expect(root.querySelector("aside.panel")?.lastElementChild?.id).toBe("f");
    expect(calls.at(-1)).toBeUndefined();
  });

  test("clicking a state that is not a next step passes the state selection", () => {
    const calls: Array<ViewerSelection | undefined> = [];
    const root = live(calls, footer());
    click(root, "end");
    expect(calls.at(-1)).toEqual({ kind: "state", id: "end" });
  });

  test("a click that walks still passes the selection", () => {
    const calls: Array<ViewerSelection | undefined> = [];
    const root = live(calls, footer());
    click(root, "done");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
    expect(calls.at(-1)).toEqual({ kind: "state", id: "done" });
  });

  test("the same node returned on every refresh appears once", () => {
    const root = live([], footer());
    click(root, "done");
    click(root, "end");
    expect(root.querySelectorAll("aside.panel #f")).toHaveLength(1);
  });

  test("ArrowLeft in a text field does not step back", () => {
    const area = document.createElement("textarea");
    const f = footer();
    f.append(area);
    const root = live([], f);
    click(root, "done");
    click(root, "end");
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("end");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("done");
  });
});
