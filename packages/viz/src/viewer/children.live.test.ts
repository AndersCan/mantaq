// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveChild,
  VizLiveState,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
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

const event = (id: string) => ({ id, internal: false, doc: null, payload: null });

const photoQueue: VizMachine = {
  id: "photoQueue",
  initial: "showingQueue",
  regions: ["photos"],
  maps: ["photos"],
  states: [
    state("showingQueue", { initial: true }),
    state("photos.sendingPhoto", { initial: true }),
    state("photos.waitingForRetry"),
    state("photos.photoSent", { final: true }),
  ],
  events: [event("uploadConfirmed"), event("uploadFailed"), event("retryPressed")],
  outputs: [],
  context: null,
  edges: [
    edge("photos.sendingPhoto", "uploadConfirmed", "photos.photoSent"),
    edge("photos.sendingPhoto", "uploadFailed", "photos.waitingForRetry"),
    edge("photos.waitingForRetry", "retryPressed", "photos.sendingPhoto"),
  ],
  runs: [],
  fuzz: null,
};

function live(children: VizLiveChild[], steps: VizStep[] = []): VizLiveState {
  return {
    state: "showingQueue",
    steps,
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children,
    effectMode: "real",
    waiting: [],
  };
}

const child = (key: string, at: string, since = 0): VizLiveChild => ({
  map: "photos",
  key,
  state: `photos.${at}`,
  since,
});

function mount(children: VizLiveChild[], machine: VizMachine = photoQueue) {
  const root = document.createElement("div");
  const sent: VizStep[] = [];
  const driver: VizDriver = {
    reset: () => live(children),
    step: (step) => {
      sent.push(step);
      return live(children, [step]);
    },
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return { root, sent };
}

describe("live actor map children", () => {
  test("no children says so", () => {
    const { root } = mount([]);
    expect(root.querySelector('[data-map="photos"] h3')?.textContent).toBe(
      "photos: no children yet",
    );
    expect(root.querySelectorAll("[data-child-key]")).toHaveLength(0);
  });

  test("each child gets a row and a Send list that goes to it", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    expect(root.querySelector('[data-map="photos"] h3')?.textContent).toBe("photos: 2 children");
    const rows = [...root.querySelectorAll("[data-child-key]")];
    expect(rows.map((row) => row.getAttribute("data-child-key"))).toEqual(["p1", "p2"]);
    expect(rows[0]?.querySelector(".explore-child-now")?.textContent).toBe(
      "p1: in sendingPhoto (new)",
    );
    const retry = root.querySelector('[data-actor="photos[p2]"] [data-send-item="retryPressed"]');
    expect(retry?.querySelector("[data-ignored]")).toBeNull();
    expect(
      root.querySelector(
        '[data-actor="photos[p2]"] [data-send-item="uploadConfirmed"] [data-ignored]',
      ),
    ).not.toBeNull();
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p1]"] [data-send="uploadConfirmed"]')
      ?.click();
    expect(sent).toEqual([
      {
        kind: "event",
        event: "uploadConfirmed",
        payload: null,
        actor: { map: "photos", key: "p1" },
      },
    ]);
  });

  test("a final child has no moves block, and (new) only on the step it appeared", () => {
    const { root } = mount([child("p1", "photoSent", 3)]);
    const row = root.querySelector('[data-child-key="p1"]');
    expect(row?.querySelector(".explore-child-now")?.textContent).toBe("p1: in photoSent (final)");
    expect(row?.querySelector("[data-actor]")).toBeNull();
  });

  test("the singular heading", () => {
    const { root } = mount([child("p1", "sendingPhoto", 5)]);
    expect(root.querySelector('[data-map="photos"] h3')?.textContent).toBe("photos: 1 child");
  });

  test("every child's state is marked on the diagram", () => {
    const { root } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    const current = [...root.querySelectorAll(".graph g.current")].map((each) =>
      each.getAttribute("data-node-id"),
    );
    expect(current.sort()).toEqual([
      "photos.sendingPhoto",
      "photos.waitingForRetry",
      "showingQueue",
    ]);
  });

  test("the compartment is labelled and tagged as an actor map", () => {
    const { root } = mount([]);
    const group = root.querySelector('.graph g.region[data-map="photos"]');
    expect(group?.querySelector("text")?.textContent).toBe("photos: one per key");
  });

  test("clicking a map edge sends only when exactly one child is in its source", () => {
    const edgeGroup = (root: HTMLElement) =>
      root.querySelector<SVGGElement>(
        '.graph g[data-edge-id="photos.sendingPhoto-uploadConfirmed-photos.photoSent"]',
      );
    const one = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    edgeGroup(one.root)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(one.sent).toEqual([
      {
        kind: "event",
        event: "uploadConfirmed",
        payload: null,
        actor: { map: "photos", key: "p1" },
      },
    ]);
    const two = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    edgeGroup(two.root)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(two.sent).toEqual([]);
  });
});
