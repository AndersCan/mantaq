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

describe("system view: branches no other test pins", () => {
  test("a root receiver reads 'takes' (one part, singular verb)", () => {
    const flow: VizMachine = {
      ...pool,
      id: "flow",
      regions: ["upload"],
      maps: [],
      states: [state("a", true), { ...state("b"), final: true }, state("upload.idle", true)],
      events: [event("DONE")],
      outputs: [],
      partOutputs: { upload: ["DONE"] },
      edges: [edge("a", "DONE", "b")],
    };
    const root = mount([flow], false);
    arrow(root, "DONE")?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-receiver]")).toBe("flow takes it in: a.");
  });

  test("Open on an arrow the receiver takes with onAny lands on the * edge", () => {
    const anyRoot: VizMachine = {
      ...pool,
      edges: [
        ...pool.edges.filter((each) => each.event !== "WORK_DONE"),
        edge("*", "WORK_DONE", "empty"),
      ],
    };
    const root = mount([anyRoot]);
    arrow(root, "WORK_DONE")?.dispatchEvent(new Event("click"));
    const open = [...root.querySelectorAll<HTMLButtonElement>("[data-open-part]")].at(-1);
    expect(open?.textContent).toBe("Open teamInbox at empty");
    open?.click();
    expect(root.querySelector(".graph g.selected")?.getAttribute("data-edge-id")).toBe(
      "*-WORK_DONE-empty",
    );
  });

  test("a click on an arrow or box switches the panel to Details", () => {
    const root = mount([pool]);
    expect(text(root, '[role="tab"][aria-selected="true"]')).toBe("Step");
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    expect(text(root, '[role="tab"][aria-selected="true"]')).toBe("Details");
  });

  test("Open switches to Details too", () => {
    const root = mount([pool]);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelector<HTMLButtonElement>('[role="tab"]')?.click();
    expect(text(root, '[role="tab"][aria-selected="true"]')).toBe("Step");
    // Open from a diagram edge's "Sends" line, reached via Open teamInbox
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[0]?.click();
    expect(text(root, '[role="tab"][aria-selected="true"]')).toBe("Details");
  });

  test("Open focuses ← System; back focuses the selected arrow", () => {
    const root = mount([pool]);
    document.body.append(root);
    arrow(root, "ITEMS_ASSIGNED")?.dispatchEvent(new Event("click"));
    root.querySelectorAll<HTMLButtonElement>("[data-open-part]")[1]?.click();
    expect(document.activeElement?.hasAttribute("data-system-back")).toBe(true);
    root.querySelector<HTMLButtonElement>("[data-system-back]")?.click();
    expect(document.activeElement?.getAttribute("data-event")).toBe("ITEMS_ASSIGNED");
    root.remove();
  });

  test("a clicked box is marked selected and Open lands on its first state", () => {
    const root = mount([pool]);
    root.querySelector('g[data-part="workers"]')?.dispatchEvent(new Event("click"));
    expect(root.querySelector('g[data-part="workers"]')?.classList.contains("selected")).toBe(true);
    root.querySelector<HTMLButtonElement>("[data-open-part]")?.click();
    expect(root.querySelector(".graph g.selected")?.getAttribute("data-node-id")).toBe(
      "workers.free",
    );
  });

  test("an arrow turns pink only when its receiver took the event", () => {
    const root = document.createElement("div");
    const driver: VizDriver = {
      reset: () => snapshot(0),
      step: () => {
        const live = snapshot(1);
        // the root, not workers, took ITEMS_ASSIGNED
        return { ...live, after: live.after.map((each) => ({ ...each, actor: undefined })) };
      },
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(arrow(root, "ITEMS_ASSIGNED")?.classList.contains("took")).toBe(false);
  });
});
