// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
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

const kitchen: VizMachine = {
  id: "kitchen",
  initial: "cooking",
  regions: ["waiter"],
  maps: [],
  actors: [],
  states: [
    state("cooking", true),
    state("waiter.serving", true),
    state("waiter.carryingDish"),
    state("waiter.onBreak"),
  ],
  events: [event("DISH_COOKED"), event("DISH_READY"), event("DISH_SERVED"), event("BREAK_STARTED")],
  outputs: ["DISH_READY"],
  partOutputs: {},
  context: null,
  edges: [
    edge("cooking", "DISH_COOKED", "cooking", ["DISH_READY"]),
    edge("waiter.serving", "DISH_READY", "waiter.carryingDish"),
    edge("waiter.carryingDish", "DISH_SERVED", "waiter.serving"),
    edge("waiter.serving", "BREAK_STARTED", "waiter.onBreak"),
  ],
  runs: [],
  fuzz: null,
};

const entry = (partial: Partial<VizLiveStep>): VizLiveStep => ({
  from: "cooking",
  event: "DISH_COOKED",
  to: "cooking",
  outcome: "stay",
  effects: [],
  sent: [],
  context: null,
  error: null,
  ...partial,
});

const taken = entry({
  from: "waiter.serving",
  event: "DISH_READY",
  to: "waiter.carryingDish",
  outcome: "transition",
  actor: { region: "waiter" },
  message: { sender: "", dropped: null },
});

const dropped = (sender: string | null) =>
  entry({
    from: "waiter.onBreak",
    event: "DISH_READY",
    to: "waiter.onBreak",
    outcome: "ignored",
    actor: { region: "waiter" },
    message: { sender, dropped: "noHandler" },
  });

/** The recorded run: cook (taken), then the waiter's own step, then cook with the waiter on a break (dropped). */
function recorded(sender: string | null): Array<{ last: VizLiveStep; after: VizLiveStep[] }> {
  return [
    { last: entry({}), after: [taken] },
    {
      last: entry({ event: "DISH_SERVED", from: "waiter.carryingDish", to: "waiter.serving" }),
      after: [],
    },
    {
      last: entry({ event: "BREAK_STARTED", from: "waiter.serving", to: "waiter.onBreak" }),
      after: [],
    },
    { last: entry({}), after: [dropped(sender)] },
    { last: entry({}), after: [] },
  ];
}

function mount(sender: string | null = "") {
  const run = recorded(sender);
  const steps: VizStep[] = [];
  const snapshot = (): VizLiveState => {
    const at = run[steps.length - 1];
    return {
      state: "cooking",
      regions: { waiter: "waiter.serving" },
      children: [],
      steps: [...steps],
      last: at?.last ?? null,
      after: at?.after ?? [],
      timers: [],
      context: null,
      payload: null,
      effectMode: "real",
      waiting: [],
    };
  };
  const driver: VizDriver = {
    reset: () => {
      steps.length = 0;
      return snapshot();
    },
    step: (step) => {
      steps.push(step);
      return snapshot();
    },
  };
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [kitchen] }, { driver });
  return { root };
}

const send = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLButtonElement>(`[data-send="${name}"]`)?.click();
const arrow = (root: HTMLElement) =>
  root.querySelector<SVGGElement>('g.link[data-event="DISH_READY"]');
const pathTexts = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-rewind]")].map((each) => each.textContent);
const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent;

/** Walks the recorded run through the Step buttons, up to and including step `count`. */
function walk(root: HTMLElement, count: number) {
  const names = ["DISH_COOKED", "DISH_SERVED", "BREAK_STARTED", "DISH_COOKED", "DISH_COOKED"];
  for (const name of names.slice(0, count)) send(root, name);
}

describe("dropped message", () => {
  test("a taken message names sender → receiver on the Path and the Step tab, and the arrow is pink", () => {
    const { root } = mount();
    walk(root, 1);
    expect(pathTexts(root)[1]).toBe("DISH_COOKED, then kitchen → waiter: serving → carryingDish");
    expect(text(root, "[data-live-after]")).toContain(
      "Then kitchen sent DISH_READY to waiter: serving → carryingDish",
    );
    expect(arrow(root)?.classList.contains("took")).toBe(true);
    expect(arrow(root)?.classList.contains("dropped")).toBe(false);
    expect(root.querySelector("[data-live-dropped]")).toBeNull();
  });

  test("a dropped one starts the Path row with !, says dropped, and marks the arrow, not pink", () => {
    const { root } = mount();
    walk(root, 4);
    expect(pathTexts(root)[4]).toBe("! DISH_COOKED, then kitchen → waiter DISH_READY dropped");
    expect(arrow(root)?.classList.contains("dropped")).toBe(true);
    expect(arrow(root)?.classList.contains("took")).toBe(false);
    expect(arrow(root)?.querySelector("text")?.textContent).toBe("DISH_READY !");
    expect(arrow(root)?.querySelector("tspan.drop-mark")).not.toBeNull();
    expect(arrow(root)?.getAttribute("aria-label")).toBe(
      "DISH_READY: kitchen to waiter, dropped in this run",
    );
    expect(text(root, "[data-live-dropped]")).toBe(
      "! Then kitchen sent DISH_READY to waiter: dropped.",
    );
    expect(root.querySelector("[data-live-dropped]")?.classList.contains("muted")).toBe(false);
  });

  test("the mark stays after a later step and is gone after rewinding to before the drop", () => {
    const { root } = mount();
    walk(root, 5);
    expect(arrow(root)?.classList.contains("dropped")).toBe(true);
    expect(arrow(root)?.classList.contains("took")).toBe(false);
    root.querySelector<HTMLElement>('[data-rewind="3"]')?.click();
    expect(arrow(root)?.classList.contains("dropped")).toBe(false);
    expect(arrow(root)?.querySelector("tspan.drop-mark")).toBeNull();
    expect(arrow(root)?.getAttribute("aria-label")).toBe("DISH_READY: kitchen to waiter");
    expect(pathTexts(root).join("|")).not.toContain("!");
  });

  test("clicking the dropped arrow says why", () => {
    const { root } = mount();
    walk(root, 4);
    arrow(root)?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-dropped]")).toBe(
      "waiter has no handler for DISH_READY in onBreak.",
    );
  });

  test("a taken arrow's Details has no drop line", () => {
    const { root } = mount();
    walk(root, 1);
    arrow(root)?.dispatchEvent(new Event("click"));
    expect(root.querySelector("[data-link-dropped]")).toBeNull();
  });

  test("a drop with no known sender shows only on the Path row", () => {
    const { root } = mount(null);
    walk(root, 4);
    expect(pathTexts(root)[4]).toBe("! DISH_COOKED, then waiter DISH_READY dropped");
    expect(text(root, "[data-live-after]")).toContain("Then waiter took DISH_READY");
    expect(root.querySelector("[data-live-dropped]")).toBeNull();
    expect(root.querySelector(".dropped")).toBeNull();
    expect(arrow(root)?.querySelector("tspan.drop-mark")).toBeNull();
    arrow(root)?.dispatchEvent(new Event("click"));
    expect(root.querySelector("[data-link-dropped]")).toBeNull();
  });

  test("a stay that took the message reads sent … to … without a move", () => {
    const run = recorded("");
    run[0] = { last: entry({}), after: [{ ...taken, outcome: "stay", to: "waiter.serving" }] };
    const root = document.createElement("div");
    const steps: VizStep[] = [];
    const driver: VizDriver = {
      reset: () => ({ ...base(), steps: [] }),
      step: (step) => ({ ...base(), steps: [...steps, step] }),
    };
    const base = (): VizLiveState => ({
      state: "cooking",
      regions: { waiter: "waiter.serving" },
      children: [],
      steps,
      last: run[0]!.last,
      after: run[0]!.after,
      timers: [],
      context: null,
      payload: null,
      effectMode: "real",
      waiting: [],
    });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [kitchen] }, { driver });
    send(root, "DISH_COOKED");
    expect(text(root, "[data-live-after]")).toContain("Then kitchen sent DISH_READY to waiter");
    expect(text(root, "[data-live-after]")).not.toContain("→ serving");
  });
});

/** A hall where the kitchen and the cooks both send DISH_READY, to the waiter and the runner, and the kitchen also sends SPECIAL to the waiter. */
const hall: VizMachine = {
  ...kitchen,
  id: "hall",
  regions: ["waiter", "runner", "cooks"],
  maps: ["cooks"],
  states: [
    state("cooking", true),
    state("waiter.serving", true),
    state("waiter.onBreak"),
    state("runner.idle", true),
    state("cooks.free", true),
  ],
  events: [event("DISH_COOKED"), event("DISH_READY"), event("SPECIAL")],
  outputs: ["DISH_READY", "SPECIAL"],
  partOutputs: { cooks: ["DISH_READY"] },
  edges: [
    edge("cooking", "DISH_COOKED", "cooking", ["DISH_READY", "SPECIAL"]),
    edge("cooks.free", "DISH_COOKED", "cooks.free", ["DISH_READY"]),
    edge("waiter.serving", "DISH_READY", "waiter.serving"),
    edge("waiter.serving", "SPECIAL", "waiter.serving"),
    edge("runner.idle", "DISH_READY", "runner.idle"),
  ],
};

function mountHall(after: VizLiveStep[][]) {
  const steps: VizStep[] = [];
  const snapshot = (): VizLiveState => ({
    state: "cooking",
    regions: { waiter: "waiter.serving", runner: "runner.idle" },
    children: [],
    steps: [...steps],
    last: steps.length === 0 ? null : entry({}),
    after: after[steps.length - 1] ?? [],
    timers: [],
    context: null,
    payload: null,
    effectMode: "real",
    waiting: [],
  });
  const driver: VizDriver = {
    reset: () => {
      steps.length = 0;
      return snapshot();
    },
    step: (step) => {
      steps.push(step);
      return snapshot();
    },
  };
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [hall] }, { driver });
  return root;
}

const to = (part: string, event: string, partial: Partial<VizLiveStep>): VizLiveStep => ({
  ...entry({ event, from: "waiter.serving", to: "waiter.serving" }),
  actor: { region: part },
  ...partial,
});

const link = (root: HTMLElement, from: string, event: string, part: string) =>
  root.querySelector(`g.link[data-from="${from}"][data-event="${event}"][data-to="${part}"]`);
const marked = (root: HTMLElement) =>
  [...root.querySelectorAll("g.link.dropped")].map(
    (each) =>
      `${each.getAttribute("data-from")}>${each.getAttribute("data-event")}>${each.getAttribute("data-to")}`,
  );

describe("dropped message among several arrows", () => {
  test("only the arrow from the sender, with the event, to the receiver is marked", () => {
    const root = mountHall([
      [
        to("waiter", "DISH_READY", {
          outcome: "ignored",
          message: { sender: "", dropped: "noHandler" },
        }),
      ],
    ]);
    send(root, "DISH_COOKED");
    expect(marked(root)).toEqual([">DISH_READY>waiter"]);
  });

  test("a message the cooks sent that the waiter took lights only the cooks' arrow", () => {
    const root = mountHall([
      [
        to("waiter", "DISH_READY", {
          outcome: "stay",
          message: { sender: "cooks", dropped: null },
        }),
      ],
    ]);
    send(root, "DISH_COOKED");
    expect(link(root, "cooks", "DISH_READY", "waiter")?.classList.contains("took")).toBe(true);
    expect(link(root, "", "DISH_READY", "waiter")?.classList.contains("took")).toBe(false);
  });

  test("Details names the reason of the latest drop on the arrow", () => {
    const drop = (from: string) =>
      to("waiter", "DISH_READY", {
        outcome: "ignored",
        from,
        to: from,
        message: { sender: "", dropped: "noHandler" },
      });
    const root = mountHall([[drop("waiter.onBreak")], [drop("waiter.onLunch")]]);
    send(root, "DISH_COOKED");
    send(root, "DISH_COOKED");
    link(root, "", "DISH_READY", "waiter")?.dispatchEvent(new Event("click"));
    expect(text(root, "[data-link-dropped]")).toBe(
      "waiter has no handler for DISH_READY in onLunch.",
    );
  });

  test("more than three things after a step end with how many are left out", () => {
    const moved = (part: string) =>
      to(part, "DISH_READY", {
        outcome: "transition",
        from: `${part}.a`,
        to: `${part}.b`,
        message: { sender: "", dropped: null },
      });
    const root = mountHall([[moved("p1"), moved("p2"), moved("p3"), moved("p4")]]);
    send(root, "DISH_COOKED");
    expect(pathTexts(root)[1]).toBe(
      "DISH_COOKED, then hall → p1: a → b; hall → p2: a → b; hall → p3: a → b and 1 more",
    );
  });
});

describe("dropped row title", () => {
  test("a dropped row that is not cut short has no title", () => {
    const { root } = mount();
    walk(root, 4);
    const row = root.querySelectorAll<HTMLElement>("[data-rewind]")[4];
    expect(row?.textContent?.startsWith("! ")).toBe(true);
    expect(row?.hasAttribute("title")).toBe(false);
  });
});

describe("a drop stays named, and its reason shows once", () => {
  test("a drop after three moves is still named on the Path row", () => {
    const moved = (part: string) =>
      to(part, "DISH_READY", {
        outcome: "transition",
        from: `${part}.a`,
        to: `${part}.b`,
        message: { sender: "", dropped: null },
      });
    const root = mountHall([
      [
        moved("p1"),
        moved("p2"),
        moved("p3"),
        to("waiter", "DISH_READY", {
          outcome: "ignored",
          from: "waiter.onBreak",
          to: "waiter.onBreak",
          message: { sender: "", dropped: "noHandler" },
        }),
      ],
    ]);
    send(root, "DISH_COOKED");
    expect(pathTexts(root)[1]).toContain("hall → waiter DISH_READY dropped");
  });

  test("the Step tab says why a message was dropped once", () => {
    const { root } = mount();
    walk(root, 4);
    const step = text(root, "[data-live-after]") ?? "";
    expect(step.match(/no handler for DISH_READY/gi)).toHaveLength(1);
  });
});
