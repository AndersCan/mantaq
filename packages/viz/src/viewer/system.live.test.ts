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

function mount(machines: VizMachine[], live = true) {
  const root = document.createElement("div");
  let arrived = 0;
  const driver: VizDriver = {
    reset: () => snapshot((arrived = 0)),
    step: () => snapshot(++arrived),
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines }, live ? { driver } : {});
  return root;
}

const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent;
const arrow = (root: HTMLElement, event: string) =>
  root.querySelector<SVGGElement>(`g.link[data-event="${event}"]`);

describe("system view", () => {
  test("a machine whose parts talk opens on boxes and arrows, with live counts", () => {
    const root = mount([pool]);
    expect(root.querySelector("svg[data-system]")).not.toBeNull();
    expect(root.querySelector("svg.graph:not([data-system])")).toBeNull();
    expect(text(root, 'g[data-part="workers"] .part-label')).toBe("workers ×3");
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("free 3");
    expect(text(root, 'g[data-part=""] .part-chip')).toBe("empty");
    expect(root.querySelector('g[data-part="workers"]')?.getAttribute("aria-label")).toBe(
      "workers, 3 running: free 3",
    );
  });

  test("a step moves the counts and turns the arrow that carried it pink", () => {
    const root = mount([pool]);
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(text(root, 'g[data-part="workers"] .part-chip')).toBe("free 2 · working 1");
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
