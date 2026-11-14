// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveChild,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { sharedPrefix } from "./system.ts";
import { describe, expect, test } from "vite-plus/test";

const state = (id: string, initial = false): VizState => ({
  id,
  label: id.slice(id.lastIndexOf(".") + 1),
  region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edge = (from: string, event: string, to: string, emits: string[] = []): VizEdge => ({
  id: `${from}-${event}-${to}`,
  from,
  event,
  to,
  kind: "transition",
  origin: "declared",
  emits,
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});

const event = (id: string) => ({ id, internal: false, doc: null, payload: null });

const pool: VizMachine = {
  id: "teamInbox",
  initial: "empty",
  regions: ["workers"],
  maps: ["workers"],
  actors: [],
  states: [
    state("empty", true),
    state("holding"),
    state("workers.free", true),
    state("workers.working"),
  ],
  events: [event("ITEM_ARRIVED"), event("ITEMS_ASSIGNED"), event("WORK_DONE"), event("FINISH")],
  outputs: ["ITEMS_ASSIGNED", "LOST"],
  partOutputs: { workers: ["WORK_DONE"] },
  context: null,
  edges: [
    edge("empty", "ITEM_ARRIVED", "holding", ["ITEMS_ASSIGNED"]),
    edge("holding", "WORK_DONE", "empty"),
    edge("workers.free", "ITEMS_ASSIGNED", "workers.working", ["WORK_DONE"]),
    edge("workers.working", "FINISH", "workers.free"),
  ],
  runs: [],
  fuzz: null,
};

const checkout: VizMachine = {
  ...pool,
  id: "checkout",
  regions: [],
  maps: [],
  actors: [],
  states: [state("empty", true), state("holding")],
  partOutputs: {},
  outputs: [],
  edges: [edge("empty", "ITEM_ARRIVED", "holding")],
};

function snapshot(arrived: number): VizLiveState {
  const children: VizLiveChild[] = ["w1", "w2", "w3"].map((key, index) => ({
    map: "workers",
    key,
    state: index < arrived ? "workers.working" : "workers.free",
    since: 0,
  }));
  const step = (partial: Partial<VizLiveStep>): VizLiveStep => ({
    from: "empty",
    event: "ITEM_ARRIVED",
    to: "holding",
    outcome: "transition",
    effects: [],
    sent: [],
    context: null,
    error: null,
    ...partial,
  });
  return {
    state: arrived > 0 ? "holding" : "empty",
    regions: {},
    children,
    steps: Array.from({ length: arrived }, (): VizStep => ({
      kind: "event",
      event: "ITEM_ARRIVED",
      payload: null,
    })),
    last: arrived > 0 ? step({}) : null,
    after:
      arrived > 0
        ? [
            step({
              from: "workers.free",
              to: "workers.working",
              event: "ITEMS_ASSIGNED",
              actor: { map: "workers", key: "w1" },
            }),
          ]
        : [],
    timers: [],
    context: null,
    payload: null,
    effectMode: "real",
    waiting: [],
  };
}

function mount(machines: VizMachine[], live = true, steps: VizStep[] = []) {
  const root = document.createElement("div");
  let arrived = 0;
  const driver: VizDriver = {
    reset: () => snapshot((arrived = 0)),
    step: (step) => {
      steps.push(step);
      return snapshot(++arrived);
    },
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines }, live ? { driver } : {});
  return root;
}

const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent;
const dots = (root: HTMLElement) =>
  [...root.querySelectorAll("g.child-dot")].map(
    (dot) => `${dot.getAttribute("data-child")}:${dot.getAttribute("data-state")}`,
  );
const arrow = (root: HTMLElement, event: string) =>
  root.querySelector<SVGGElement>(`g.link[data-event="${event}"]`);

describe("system view", () => {
  test("a machine whose parts talk opens on boxes and arrows, with live counts", () => {
    const root = mount([pool]);
    expect(root.querySelector("svg[data-system]")).not.toBeNull();
    expect(root.querySelector("svg.graph:not([data-system])")).toBeNull();
    expect(text(root, 'g[data-part="workers"] .part-label')).toBe("workers ×3");
    expect(dots(root)).toEqual(["w1:free", "w2:free", "w3:free"]);
    expect(text(root, 'g[data-part=""] .part-chip')).toBe("empty");
    expect(root.querySelector('g[data-part="workers"]')?.getAttribute("aria-label")).toBe(
      "workers, 3 running: free 3",
    );
  });

  test("a step moves the counts and turns the arrow that carried it pink", () => {
    const root = mount([pool]);
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(dots(root)).toEqual(["w1:working", "w2:free", "w3:free"]);
    expect(root.querySelector('g.child-dot[data-child="w1"] title')?.textContent).toBe(
      "w1, working",
    );
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("");
    expect(text(root, 'g[data-part=""] .part-chip')).toBe("holding");
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(true);
    expect(arrow(root, "WORK_DONE")?.classList.contains("took")).toBe(false);
    expect(text(root, "[data-live-cascade]")).toContain("then w1: free → working");
  });

  test("an output nobody takes ends at an out mark", () => {
    const root = mount([pool]);
    expect(root.querySelector("g[data-link-out]")?.textContent).toContain("out of teamInbox");
  });

  test("without a driver the box reads ×n and has no chip", () => {
    const root = mount([pool], false);
    expect(text(root, 'g[data-part="workers"] .part-label')).toBe("workers ×n");
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("");
  });

  test("a machine without linked parts shows only the diagram", () => {
    const root = mount([checkout]);
    expect(root.querySelector("svg[data-system]")).toBeNull();
    expect(root.querySelector("svg.graph")).not.toBeNull();
    expect(root.querySelector("[data-system-back]")).toBeNull();
  });

  test("clicking an arrow tells who sends it and who takes it where", () => {
    const root = mount([pool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("selected")).toBe(true);
    expect(text(root, "[data-link-sender]")).toBe(
      "teamInbox sends ITEMS_ASSIGNED. On: ITEM_ARRIVED.",
    );
    expect(text(root, "[data-link-receiver]")).toBe("workers take it in: free.");
    const buttons = [...root.querySelectorAll("[data-open-part]")].map((each) => each.textContent);
    expect(buttons).toEqual(["Open teamInbox", "Open workers at free"]);
  });

  test("an out arrow says it leaves the machine and offers only the sender", () => {
    const root = mount([pool]);
    arrow(root, "LOST")?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-receiver]")).toBe(
      "Nothing in teamInbox takes it; it leaves the machine.",
    );
    expect(root.querySelectorAll("[data-open-part]")).toHaveLength(1);
  });

  test("clicking a box shows its state", () => {
    const root = mount([pool]);
    root.querySelector('g[data-part="workers"]')?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-part-state]")).toBe("free 3");
  });

  test("Open lands on the handling edge without walking, and ← System comes back", () => {
    const root = mount([pool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[1]?.click();
    expect(root.querySelector("svg[data-system]")).toBeNull();
    expect(root.querySelector(".graph g.selected")?.getAttribute("data-edge-id")).toBe(
      "workers.free-ITEMS_ASSIGNED-workers.working",
    );
    expect(root.querySelector("[data-system-back]")).not.toBeNull();
    expect(text(root, "[data-live-outcome]") ?? "").toBe("");
    root.querySelector<HTMLButtonElement>("[data-system-back]")?.click();
    expect(root.querySelector("svg[data-system]")).not.toBeNull();
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("selected")).toBe(true);
    expect(root.querySelector("[data-system-back]")).toBeNull();
  });

  test("a diagram edge that sends to another part offers to open it", () => {
    const root = mount([pool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[0]?.click();
    expect(text(root, "[data-sends]")).toBe("Sends ITEMS_ASSIGNED to workers");
    expect(text(root, "[data-open-part]")).toBe("Open workers at free");
  });

  test("a state that takes the event through any-state reads as every state", () => {
    const anyPool: VizMachine = {
      ...pool,
      edges: [
        ...pool.edges.filter((each) => each.from !== "workers.working"),
        edge("workers.*", "ITEMS_ASSIGNED", "workers.working"),
      ],
    };
    const root = mount([anyPool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-receiver]")).toBe("workers take it in every state.");
  });

  test("a step the receiver never ran does not turn the arrow pink", () => {
    const root = document.createElement("div");
    const driver: VizDriver = {
      reset: () => snapshot(0),
      step: () => {
        const live = snapshot(1);
        return {
          ...live,
          after: live.after.map((each) => ({ ...each, outcome: "missing" as const })),
        };
      },
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(false);
  });

  test("the step's own event turns its arrow pink when the receiver's actor took it", () => {
    const root = document.createElement("div");
    const driver: VizDriver = {
      reset: () => snapshot(0),
      step: () => {
        const live = snapshot(1);
        return {
          ...live,
          last: {
            ...(live.last as VizLiveStep),
            event: "ITEMS_ASSIGNED",
            actor: { map: "workers", key: "w1" },
          },
          after: [],
        };
      },
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(true);
  });

  test("back shows the arrow's Details, not the diagram edge Open selected", () => {
    const root = mount([pool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[1]?.click();
    root.querySelector<HTMLButtonElement>("[data-system-back]")?.click();
    expect(root.querySelector("[data-selected-link]")).not.toBeNull();
    expect(root.querySelector("[data-sends]")).toBeNull();
  });

  test("an arrow with no known sender edge opens its sender's first state", () => {
    const quiet: VizMachine = {
      ...pool,
      edges: pool.edges.map((each) => ({ ...each, emits: [] })),
    };
    const root = mount([quiet]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-sender]")).toBe("teamInbox sends ITEMS_ASSIGNED.");
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[0]?.click();
    expect(root.querySelector(".graph g.selected")?.getAttribute("data-node-id")).toBe("empty");
  });

  test("switching machine goes back to that machine's default view", () => {
    const root = mount([pool, checkout], false);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[1]?.click();
    const picker = root.querySelector<HTMLSelectElement>(".machine-select");
    if (picker === null) throw new Error("no picker");
    picker.value = "checkout";
    picker.dispatchEvent(new Event("change"));
    picker.value = "teamInbox";
    picker.dispatchEvent(new Event("change"));
    expect(root.querySelector("svg[data-system]")).not.toBeNull();
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("selected")).toBe(false);
  });

  test("the first state is an open ring and the second a filled dot", () => {
    const root = mount([pool]);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    const marks = [...root.querySelectorAll("g.child-dot")].map((dot) =>
      dot.getAttribute("data-mark"),
    );
    expect(marks).toEqual(["second", "first", "first"]);
  });

  test("a child machine without two non-final states keeps the count text and no key item", () => {
    const three: VizMachine = {
      ...pool,
      states: [...pool.states, state("workers.stuck")],
    };
    const root = mount([three]);
    expect(root.querySelector("g.child-dot")).toBeNull();
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("free 3");
    expect(root.querySelector("[data-viz-key]")).toBeNull();
  });

  test("six children get dots; seven fall back to the count text", () => {
    const withChildren = (count: number) => {
      const root = document.createElement("div");
      const live = (): VizLiveState => ({
        ...snapshot(0),
        children: Array.from({ length: count }, (_, index) => ({
          map: "workers",
          key: `w${index}`,
          state: "workers.free",
          since: 0,
        })),
      });
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] },
        { driver: { reset: live, step: live } },
      );
      return root;
    };
    expect(withChildren(6).querySelectorAll("g.child-dot")).toHaveLength(6);
    const seven = withChildren(7);
    expect(seven.querySelector("g.child-dot")).toBeNull();
    expect(text(seven, 'g[data-part="workers"] .part-chip')).toBe("free 7");
  });

  test("no driver: no dots and no dot key", () => {
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] });
    expect(root.querySelector("g.child-dot")).toBeNull();
    expect(root.querySelector("[data-viz-key]")).toBeNull();
    expect(text(root, 'g[data-part="workers"] .part-label')).toBe("workers ×n");
  });

  test("a map with no children reads none running", () => {
    const root = document.createElement("div");
    const driver: VizDriver = {
      reset: () => ({ ...snapshot(0), children: [] }),
      step: () => snapshot(1),
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
    expect(text(root, 'g[data-part="workers"] .part-label')).toBe("workers ×0");
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("none running");
    expect(root.querySelector('g[data-part="workers"]')?.getAttribute("aria-label")).toBe(
      "workers, none running",
    );
  });
});

describe("pool view arrows", () => {
  const pairs = (root: HTMLElement) => root.querySelectorAll("g.link-pair:not([data-link-out])");

  test("one arrow each way between the boxes, with the entry pill into the root", () => {
    const root = mount([pool]);
    expect(pairs(root)).toHaveLength(2);
    expect(text(root, "g.link-start")).toBe("from outside");
    expect(root.querySelector('g.link-in [data-entry-event="ITEM_ARRIVED"]')).not.toBeNull();
  });

  test("two events from one part to another are lines on one arrow", () => {
    const busy: VizMachine = {
      ...pool,
      partOutputs: { workers: ["WORK_DONE", "WORK_FAILED"] },
      edges: [...pool.edges, edge("holding", "WORK_FAILED", "empty")],
    };
    const root = mount([busy]);
    const back = root.querySelector('g.link-pair[data-from="workers"]:not([data-link-out])');
    expect(back?.querySelectorAll("g.link")).toHaveLength(2);
    expect(root.querySelectorAll('g.link-pair[data-from="workers"]')).toHaveLength(1);
  });

  test("a step turns the pair pink and clicking the pill sends the event", () => {
    const root = mount([pool]);
    const assigned = root.querySelector('g.link-pair[data-from=""][data-to="workers"]');
    expect(assigned?.classList.contains("took")).toBe(false);
    root
      .querySelector<SVGGElement>('[data-entry-event="ITEM_ARRIVED"]')
      ?.dispatchEvent(new Event("click"));
    expect(assigned?.classList.contains("took")).toBe(true);
    expect(text(root, 'g[data-part=""] .part-chip')).toBe("holding");
  });

  const workerStates = (root: HTMLElement) =>
    root.querySelector('g[data-part="workers"]')?.getAttribute("aria-label");

  test("clicking the pill turns a worker dot to working", () => {
    const root = mount([pool]);
    const before = workerStates(root);
    root.querySelector("g.link-start")?.dispatchEvent(new Event("click"));
    expect(workerStates(root)).not.toBe(before);
    expect(workerStates(root)).toContain("working");
  });

  test.each(["Enter", " "])("key %j on the pill sends and keeps focus", (key) => {
    const steps: VizStep[] = [];
    const root = mount([pool], true, steps);
    const pill = root.querySelector<SVGGElement>("g.link-start");
    expect(pill?.getAttribute("role")).toBe("button");
    pill?.dispatchEvent(new KeyboardEvent("keydown", { key }));
    expect(steps).toEqual([{ kind: "event", event: "ITEM_ARRIVED", payload: null }]);
    expect(root.querySelector("g.link-start")).toBe(pill);
  });

  test("the pill is plain without a driver or with several entry events", () => {
    expect(mount([pool], false).querySelector("g.link-start")?.getAttribute("tabindex")).toBeNull();
    const two: VizMachine = {
      ...pool,
      events: [...pool.events, event("OTHER")],
      edges: [...pool.edges, edge("empty", "OTHER", "holding")],
    };
    expect(mount([two]).querySelector("g.link-start")?.getAttribute("tabindex")).toBeNull();
  });

  test("without a driver the entry line is drawn and does nothing", () => {
    const root = mount([pool], false);
    const line = root.querySelector<SVGGElement>('[data-entry-event="ITEM_ARRIVED"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute("tabindex")).toBeNull();
    expect(line?.getAttribute("role")).toBeNull();
  });

  const team: VizMachine = {
    ...pool,
    events: [event("team.ITEM_ARRIVED"), event("team.ITEMS_ASSIGNED"), event("team.WORK_DONE")],
    outputs: ["team.ITEMS_ASSIGNED"],
    partOutputs: { workers: ["team.WORK_DONE"] },
    edges: [
      edge("empty", "team.ITEM_ARRIVED", "holding", ["team.ITEMS_ASSIGNED"]),
      edge("holding", "team.WORK_DONE", "empty"),
      edge("workers.free", "team.ITEMS_ASSIGNED", "workers.working", ["team.WORK_DONE"]),
    ],
  };

  test("a shared prefix is written once in the key and kept in ids", () => {
    const root = mount([team]);
    expect(text(root, "[data-viz-key]")).toBe("events: team.*   ○ free  ● working");
    const line = root.querySelector('g.link[data-event="team.ITEMS_ASSIGNED"]');
    expect(line?.textContent).toBe("ITEMS_ASSIGNED");
    expect(line?.getAttribute("aria-label")).toContain("team.ITEMS_ASSIGNED");
  });

  test("mixed prefixes show full names and no key", () => {
    const root = mount([pool]);
    expect(text(root, "[data-viz-key]")).toBe("○ free  ● working");
    expect(arrow(root, "ITEMS_ASSIGNED")?.textContent).toBe("ITEMS_ASSIGNED");
    const mixed: VizMachine = {
      ...team,
      events: [...team.events, event("OTHER.X")],
      outputs: ["team.ITEMS_ASSIGNED", "OTHER.X"],
    };
    const again = mount([mixed]);
    expect(again.querySelector("[data-viz-key]")?.textContent).toBe("○ free  ● working");
    expect(again.querySelector('g.link[data-event="team.ITEMS_ASSIGNED"]')?.textContent).toBe(
      "team.ITEMS_ASSIGNED",
    );
  });
});

describe("sharedPrefix", () => {
  test("is the text up to the first dot when 2 or more events share it", () => {
    expect(sharedPrefix(["team.A", "team.B"])).toBe("team.");
    expect(sharedPrefix(["a.b.A", "a.b.B"])).toBe("a.");
  });

  test("is empty for one event, no dot or a differing prefix", () => {
    expect(sharedPrefix([])).toBe("");
    expect(sharedPrefix(["team.A"])).toBe("");
    expect(sharedPrefix(["team.A", "team.A"])).toBe("");
    expect(sharedPrefix(["A", "B"])).toBe("");
    expect(sharedPrefix([".A", ".B"])).toBe("");
    expect(sharedPrefix(["team.A", "other.B"])).toBe("");
    expect(sharedPrefix(["team.", "team.B"])).toBe("");
  });
});

describe("pool view arrows: attacked", () => {
  const pairOf = (root: HTMLElement, from: string, to: string) =>
    root.querySelector(`g.link-pair[data-from="${from}"][data-to="${to}"]`);
  const lineY = (line: Element | null | undefined) =>
    Number(line?.querySelector("text")?.getAttribute("y"));

  test("the pill sends its own event to the root", () => {
    const steps: VizStep[] = [];
    const root = mount([pool], true, steps);
    root.querySelector('[data-entry-event="ITEM_ARRIVED"]')?.dispatchEvent(new Event("click"));
    expect(steps).toEqual([{ kind: "event", event: "ITEM_ARRIVED", payload: null }]);
  });

  const lanes: VizMachine = {
    ...pool,
    regions: ["workers", "net"],
    partOutputs: { workers: ["WORK_DONE"], net: ["NET_UP"] },
    states: [...pool.states, state("net.up", true), state("net.down")],
    events: [...pool.events, event("DROP"), event("RESTORE")],
    edges: [
      ...pool.edges,
      edge("net.up", "DROP", "net.down"),
      edge("net.down", "RESTORE", "net.up", ["NET_UP"]),
      edge("empty", "NET_UP", "empty"),
    ],
  };

  test("an entry line into a region sends to that region", () => {
    const steps: VizStep[] = [];
    const root = mount([lanes], true, steps);
    root.querySelector('[data-entry-event="DROP"]')?.dispatchEvent(new Event("click"));
    expect(steps).toEqual([
      { kind: "event", event: "DROP", payload: null, actor: { region: "net" } },
    ]);
  });

  test("the root's entries leave out region events and keep only its own", () => {
    const root = mount([lanes]);
    const events = [...root.querySelectorAll('g.link-in[data-to=""] [data-entry-event]')].map(
      (line) => line.getAttribute("data-entry-event"),
    );
    expect(events).toEqual(["ITEM_ARRIVED"]);
  });

  test("repro: the pill is plain when entries reach two parts", () => {
    const pill = mount([lanes]).querySelector("g.link-start");
    expect(pill?.getAttribute("tabindex")).toBeNull();
    expect(pill?.getAttribute("role")).toBeNull();
  });

  test("repro: a pill whose one entry goes into a region sends to that region", () => {
    const steps: VizStep[] = [];
    const netOnly: VizMachine = {
      ...lanes,
      events: lanes.events.map((each) =>
        each.id === "ITEM_ARRIVED" || each.id === "RESTORE" ? { ...each, internal: true } : each,
      ),
    };
    const root = mount([netOnly], true, steps);
    const pill = root.querySelector("g.link-start");
    expect(pill?.getAttribute("aria-label")).toBe("DROP: from outside to net");
    pill?.dispatchEvent(new Event("click"));
    expect(steps).toEqual([
      { kind: "event", event: "DROP", payload: null, actor: { region: "net" } },
    ]);
  });

  test("repro: the pill is named for the event it sends", () => {
    const pill = mount([pool]).querySelector("g.link-start");
    expect(pill?.getAttribute("aria-label")).toBe("ITEM_ARRIVED: from outside to teamInbox");
  });

  test("a pair is pink when one of its lines took and the other did not", () => {
    const mixed: VizMachine = {
      ...pool,
      events: [...pool.events, event("ITEMS_HELD")],
      outputs: ["ITEMS_ASSIGNED", "ITEMS_HELD", "LOST"],
      edges: [
        edge("empty", "ITEM_ARRIVED", "holding", ["ITEMS_ASSIGNED", "ITEMS_HELD"]),
        ...pool.edges.slice(1),
        edge("workers.free", "ITEMS_HELD", "workers.free"),
      ],
    };
    const root = mount([mixed]);
    root.querySelector('[data-entry-event="ITEM_ARRIVED"]')?.dispatchEvent(new Event("click"));
    const into = pairOf(root, "", "workers");
    expect(into?.querySelectorAll("g.link")).toHaveLength(2);
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(true);
    expect(arrow(root, "ITEMS_HELD")?.classList.contains("took")).toBe(false);
    expect(into?.classList.contains("took")).toBe(true);
  });

  test("every arrow path sits in a .edge group so it keeps the arrow style", () => {
    const root = mount([pool]);
    const paths = [...root.querySelectorAll("svg path:not(.arrow-head)")];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => path.closest(".edge") === null)).toHaveLength(0);
  });

  test("selecting a line turns its pair teal", () => {
    const root = mount([pool]);
    root.querySelector('g.link[data-event="ITEMS_ASSIGNED"]')?.dispatchEvent(new Event("click"));
    expect(pairOf(root, "", "workers")?.classList.contains("selected")).toBe(true);
    expect(pairOf(root, "workers", "")?.classList.contains("selected")).toBe(false);
  });

  const stacked: VizMachine = {
    ...pool,
    partOutputs: { workers: ["WORK_DONE", "WORK_FAILED", "WORK_LOST"] },
    edges: [
      ...pool.edges,
      edge("holding", "WORK_FAILED", "empty"),
      edge("holding", "WORK_LOST", "empty"),
    ],
  };

  test("stacked lines sit one row apart", () => {
    const root = mount([stacked]);
    const lines = [...(pairOf(root, "workers", "")?.querySelectorAll("g.link") ?? [])];
    expect(lines).toHaveLength(3);
    expect(lineY(lines[1]) - lineY(lines[0])).toBe(16);
    expect(lineY(lines[2]) - lineY(lines[1])).toBe(16);
  });

  test("a part's entry shows although another part links into it", () => {
    const both: VizMachine = {
      ...pool,
      edges: [...pool.edges, edge("empty", "WORK_DONE", "empty")],
    };
    const root = mount([both]);
    expect(root.querySelector('[data-entry-event="ITEM_ARRIVED"]')).not.toBeNull();
  });

  test("entry text drops the shared prefix; an unshared entry keeps its name", () => {
    const prefixed: VizMachine = {
      ...pool,
      events: [event("team.ITEM_ARRIVED"), event("team.ITEMS_ASSIGNED"), event("team.WORK_DONE")],
      outputs: ["team.ITEMS_ASSIGNED"],
      partOutputs: { workers: ["team.WORK_DONE"] },
      edges: [
        edge("empty", "team.ITEM_ARRIVED", "holding", ["team.ITEMS_ASSIGNED"]),
        edge("holding", "team.WORK_DONE", "empty"),
        edge("workers.free", "team.ITEMS_ASSIGNED", "workers.working", ["team.WORK_DONE"]),
      ],
    };
    const root = mount([prefixed]);
    const entry = root.querySelector('[data-entry-event="team.ITEM_ARRIVED"]');
    expect(entry?.textContent).toBe("ITEM_ARRIVED");
    expect(entry?.getAttribute("aria-label")).toContain("team.ITEM_ARRIVED");
  });
});

describe("pool view arrows: every branch", () => {
  const pairOf = (root: HTMLElement, from: string, to: string) =>
    root.querySelector(`g.link-pair[data-from="${from}"][data-to="${to}"]`);
  const lanes: VizMachine = {
    ...pool,
    regions: ["workers", "net"],
    partOutputs: { workers: ["WORK_DONE"], net: ["NET_UP"] },
    states: [...pool.states, state("net.up", true), state("net.down")],
    events: [...pool.events, event("DROP"), event("RESTORE")],
    edges: [
      ...pool.edges,
      edge("net.up", "DROP", "net.down"),
      edge("net.down", "RESTORE", "net.up", ["NET_UP"]),
      edge("empty", "NET_UP", "empty"),
    ],
  };
  const stacked: VizMachine = {
    ...pool,
    partOutputs: { workers: ["WORK_DONE", "WORK_FAILED", "WORK_LOST"] },
    edges: [
      ...pool.edges,
      edge("holding", "WORK_FAILED", "empty"),
      edge("holding", "WORK_LOST", "empty"),
    ],
  };
  const rootEntries = (root: HTMLElement) =>
    [...root.querySelectorAll('g.link-in[data-to=""] [data-entry-event]')].map((line) =>
      line.getAttribute("data-entry-event"),
    );

  test("the second entry line of a part sends its own event", () => {
    const steps: VizStep[] = [];
    const root = mount([lanes], true, steps);
    root.querySelector('[data-entry-event="RESTORE"]')?.dispatchEvent(new Event("click"));
    expect(steps).toEqual([
      { kind: "event", event: "RESTORE", payload: null, actor: { region: "net" } },
    ]);
  });

  test("an unprefixed entry keeps the key off and every name whole", () => {
    const mixed: VizMachine = {
      ...pool,
      events: [event("ITEM_ARRIVED"), event("team.ITEMS_ASSIGNED"), event("team.WORK_DONE")],
      outputs: ["team.ITEMS_ASSIGNED"],
      partOutputs: { workers: ["team.WORK_DONE"] },
      edges: [
        edge("empty", "ITEM_ARRIVED", "holding", ["team.ITEMS_ASSIGNED"]),
        edge("holding", "team.WORK_DONE", "empty"),
        edge("workers.free", "team.ITEMS_ASSIGNED", "workers.working", ["team.WORK_DONE"]),
      ],
    };
    const root = mount([mixed]);
    expect(root.querySelector('[data-entry-event="ITEM_ARRIVED"]')?.textContent).toBe(
      "ITEM_ARRIVED",
    );
    expect(arrow(root, "team.ITEMS_ASSIGNED")?.textContent).toBe("team.ITEMS_ASSIGNED");
    expect(text(root, ".viz-key")).toBe("○ free  ● working");
  });

  test("an event a link brings to one part is still an entry of another part", () => {
    const both: VizMachine = {
      ...pool,
      edges: [...pool.edges, edge("holding", "ITEMS_ASSIGNED", "holding")],
    };
    expect(rootEntries(mount([both]))).toEqual(["ITEMS_ASSIGNED", "ITEM_ARRIVED"]);
  });

  test("effect and initial edges are no entries", () => {
    const effects: VizMachine = {
      ...pool,
      events: [...pool.events, event("PING")],
      edges: [
        ...pool.edges,
        { ...edge("empty", "PING", "empty"), kind: "effect" },
        { ...edge("empty", "PONG", "holding"), kind: "initial" },
      ],
    };
    expect(rootEntries(mount([effects]))).toEqual(["ITEM_ARRIVED"]);
  });

  test("a pair of three lines is selected when its second line is", () => {
    const root = mount([stacked]);
    root.querySelector('g.link[data-event="WORK_FAILED"]')?.dispatchEvent(new Event("click"));
    expect(pairOf(root, "workers", "")?.classList.contains("selected")).toBe(true);
  });

  test("three stacked lines make the diagram two rows taller than one line", () => {
    const height = (machine: VizMachine) =>
      Number(mount([machine]).querySelector("svg")?.getAttribute("viewBox")?.split(" ")[3]);
    expect(height(stacked) - height(pool)).toBeGreaterThanOrEqual(16);
  });
});

describe("child dots: the key and the marks match what is drawn", () => {
  const withChildren = (machine: VizMachine, states: string[]) => {
    const root = document.createElement("div");
    const live = (): VizLiveState => ({
      ...snapshot(0),
      children: states.map((at, index) => ({
        map: "workers",
        key: `w${index}`,
        state: at,
        since: 0,
      })),
    });
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { driver: { reset: live, step: live } },
    );
    return root;
  };

  test("seven children: count text and no dot key", () => {
    const root = withChildren(
      pool,
      Array.from({ length: 7 }, () => "workers.free"),
    );
    expect(root.querySelector("g.child-dot")).toBeNull();
    expect(text(root, "[data-viz-key]")).toBe(undefined);
  });

  test("no children: no dot key", () => {
    const root = withChildren(pool, []);
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("none running");
    expect(text(root, "[data-viz-key]")).toBe(undefined);
  });

  test("a child in a final state is not drawn as the second state", () => {
    const withDone: VizMachine = {
      ...pool,
      states: [...pool.states, { ...state("workers.done"), final: true }],
    };
    const root = withChildren(withDone, ["workers.free", "workers.done"]);
    expect(root.querySelector('g.child-dot[data-child="w1"]')?.getAttribute("data-mark")).not.toBe(
      "second",
    );
  });

  test("dots are drawn sorted by key, one circle each at distinct positions", () => {
    const root = withChildren(pool, ["workers.free", "workers.working", "workers.free"]);
    const keys = (r: HTMLElement) => [...r.querySelectorAll("g.child-dot")];
    const unsorted = document.createElement("div");
    const live = (): VizLiveState => ({
      ...snapshot(0),
      children: ["w3", "w1", "w2"].map((key) => ({
        map: "workers",
        key,
        state: "workers.free",
        since: 0,
      })),
    });
    mountViewer(
      unsorted,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] },
      { driver: { reset: live, step: live } },
    );
    expect(dots(unsorted)).toEqual(["w1:free", "w2:free", "w3:free"]);
    const cx = keys(root).map((dot) => dot.querySelector("circle")?.getAttribute("cx"));
    expect(cx).toEqual(["-16", "0", "16"]);
    expect(text(root, "[data-viz-key]")).toContain("○ free  ● working");
  });

  test("a child in a final state draws the count text and no dot key", () => {
    const withDone: VizMachine = {
      ...pool,
      states: [...pool.states, { ...state("workers.done"), final: true }],
    };
    const root = withChildren(withDone, ["workers.free", "workers.done"]);
    expect(root.querySelector("g.child-dot")).toBeNull();
    expect(text(root, "[data-viz-key]")).toBe(undefined);
  });

  test("a child machine with one non-final state draws no dots", () => {
    const one: VizMachine = {
      ...pool,
      states: pool.states.filter((s) => s.id !== "workers.working"),
    };
    const root = withChildren(one, ["workers.free"]);
    expect(root.querySelector("g.child-dot")).toBeNull();
  });
  test("a child machine with a final state still draws dots for its two other states", () => {
    const withDone: VizMachine = {
      ...pool,
      states: [...pool.states, { ...state("workers.done"), final: true }],
    };
    const root = withChildren(withDone, ["workers.free", "workers.working"]);
    expect(dots(root)).toEqual(["w0:free", "w1:working"]);
    expect(text(root, "[data-viz-key]")).toContain("○ free  ● working");
  });
});
