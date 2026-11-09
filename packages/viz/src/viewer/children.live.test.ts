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

function mount(
  children: VizLiveChild[],
  machine: VizMachine = photoQueue,
  answer?: (step: VizStep) => VizLiveStep,
) {
  const root = document.createElement("div");
  const sent: VizStep[] = [];
  const driver: VizDriver = {
    reset: () => live(children),
    step: (step) => {
      sent.push(step);
      return { ...live(children, [step]), last: answer?.(step) ?? null };
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

  const edgeGroup = (root: HTMLElement) =>
    root.querySelector<SVGGElement>(
      '.graph g[data-edge-id="photos.sendingPhoto-uploadConfirmed-photos.photoSent"]',
    );
  const click = (element: Element | null | undefined) =>
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const sentTo = (key: string) => [
    { kind: "event", event: "uploadConfirmed", payload: null, actor: { map: "photos", key } },
  ];
  const marker = (root: HTMLElement, key: string) =>
    root.querySelector<SVGGElement>(`g.child-marker[data-marker-key="${key}"]`);

  test("an arrow goes to the only child in its source", () => {
    const one = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    click(edgeGroup(one.root));
    expect(one.sent).toEqual(sentTo("p1"));
  });

  test("an arrow with two children in its state goes to the first started", () => {
    const two = mount([child("p2", "sendingPhoto", 2), child("p1", "sendingPhoto", 1)]);
    click(edgeGroup(two.root));
    expect(two.sent).toEqual(sentTo("p1"));
  });

  test("an arrow with no child in its state does nothing", () => {
    const none = mount([child("p1", "waitingForRetry")]);
    click(edgeGroup(none.root));
    expect(none.sent).toEqual([]);
  });

  test("a picked child takes the arrow", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)]);
    click(marker(two.root, "p2"));
    expect(marker(two.root, "p2")?.getAttribute("aria-pressed")).toBe("true");
    click(edgeGroup(two.root));
    expect(two.sent).toEqual(sentTo("p2"));
  });

  test("with a child picked, another child's arrow is not next and its click shows details", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "waitingForRetry", 2)]);
    click(marker(two.root, "p2"));
    click(edgeGroup(two.root));
    expect(two.sent).toEqual([]);
    expect(two.root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  test("children that started together go to the first in array order", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 1)]);
    click(edgeGroup(two.root));
    expect(two.sent).toEqual(sentTo("p1"));
  });

  test("Esc drops the pick", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)]);
    click(marker(two.root, "p2"));
    two.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(marker(two.root, "p2")?.getAttribute("aria-pressed")).toBe("false");
    click(edgeGroup(two.root));
    expect(two.sent).toEqual(sentTo("p1"));
  });

  test("a click on a marker again drops the pick", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)]);
    click(marker(two.root, "p2"));
    click(marker(two.root, "p2"));
    click(edgeGroup(two.root));
    expect(two.sent).toEqual(sentTo("p1"));
  });

  test("a pick drops when the child is gone", () => {
    let kids = [child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)];
    const root = document.createElement("div");
    const sent: VizStep[] = [];
    const driver: VizDriver = {
      reset: () => live(kids),
      step: (step) => {
        sent.push(step);
        kids = [child("p1", "sendingPhoto", 1)];
        return live(kids, [step]);
      },
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [photoQueue] }, { driver });
    click(marker(root, "p2"));
    click(root.querySelector('[data-actor="photos[p1]"] [data-send="uploadConfirmed"]'));
    expect(marker(root, "p2")).toBeNull();
    const before = sent.length;
    click(edgeGroup(root));
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)).toMatchObject({ actor: { key: "p1" } });
  });

  test("a marker click does not select the state", () => {
    const one = mount([child("p1", "sendingPhoto", 1)]);
    click(marker(one.root, "p1"));
    expect(one.root.querySelector(".graph g.selected")).toBeNull();
  });

  test("Esc inside a dialog keeps the pick", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)]);
    click(marker(two.root, "p2"));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    two.root.append(dialog);
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(marker(two.root, "p2")?.getAttribute("aria-pressed")).toBe("true");
  });

  test("markers slide only after a step", () => {
    const one = mount([child("p1", "sendingPhoto", 1)]);
    const layer = () => one.root.querySelector(".child-markers");
    expect(layer()?.classList.contains("still")).toBe(true);
    click(edgeGroup(one.root));
    expect(layer()?.classList.contains("still")).toBe(false);
    click(marker(one.root, "p1"));
    expect(layer()?.classList.contains("still")).toBe(true);
  });

  test("markers slide when an effect result arrives", () => {
    const root = document.createElement("div");
    let notify: (state: VizLiveState) => void = () => undefined;
    const driver: VizDriver = {
      reset: () => live([child("p1", "sendingPhoto", 1)]),
      step: (step) => live([child("p1", "sendingPhoto", 1)], [step]),
      listen: (callback) => {
        notify = callback;
      },
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [photoQueue] }, { driver });
    notify(live([child("p1", "photoSent", 1)]));
    expect(root.querySelector(".child-markers")?.classList.contains("still")).toBe(false);
    expect(marker(root, "p1")?.getAttribute("data-marker-state")).toBe("photos.photoSent");
  });

  test("a child step reads the map, the key and the move", () => {
    const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      from: "photos.sendingPhoto",
      event: "uploadConfirmed",
      to: "photos.photoSent",
      outcome: "transition",
      actor: { map: "photos", key: "p1" },
      effects: [],
      sent: [],
      context: null,
      error: null,
    }));
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p1]"] [data-send="uploadConfirmed"]')
      ?.click();
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "uploadConfirmed: photos p1: sendingPhoto → photoSent",
    );
  });

  test("a step to a removed child says it is not there", () => {
    const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      from: "",
      event: "uploadConfirmed",
      to: "",
      outcome: "missing",
      actor: { map: "photos", key: "p2" },
      effects: [],
      sent: [],
      context: null,
      error: null,
    }));
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p1]"] [data-send="uploadConfirmed"]')
      ?.click();
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "p2 is not in photos (it was removed or never added). Nothing ran.",
    );
  });

  test("a payload event for a child opens the sheet on the child's edge and sends to it", () => {
    const withPayload: VizMachine = {
      ...photoQueue,
      events: photoQueue.events.map((each) =>
        each.id === "retryPressed"
          ? {
              ...each,
              payload: [
                {
                  name: "note",
                  type: "string",
                  optional: false,
                  doc: null,
                  input: "text",
                  choices: [],
                  sample: "x",
                },
              ],
            }
          : each,
      ),
    };
    const { root, sent } = mount(
      [child("p1", "sendingPhoto"), child("p2", "waitingForRetry")],
      withPayload,
    );
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p2]"] [data-send="retryPressed"]')
      ?.click();
    expect(sent).toEqual([]);
    expect(root.querySelector('.payload-sheet [data-payload-form="retryPressed"]')).not.toBeNull();
    expect(
      [...root.querySelectorAll("[data-composing]")].map((each) =>
        each.getAttribute("data-edge-id"),
      ),
    ).toEqual(["photos.waitingForRetry-retryPressed-photos.sendingPhoto"]);
    root.querySelector<HTMLButtonElement>('[data-payload-send="retryPressed"]')?.click();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "event",
      event: "retryPressed",
      actor: { map: "photos", key: "p2" },
    });
  });

  test("a payload edge click with a known value sends to the child in its source", () => {
    const withReason: VizMachine = {
      ...photoQueue,
      events: photoQueue.events.map((each) =>
        each.id === "uploadFailed"
          ? {
              ...each,
              payload: [
                {
                  name: "reason",
                  type: "string",
                  optional: false,
                  doc: null,
                  input: "text",
                  choices: [],
                  sample: "offline",
                },
              ],
            }
          : each,
      ),
    };
    const { root, sent } = mount([child("p1", "sendingPhoto")], withReason);
    root
      .querySelector(
        '.graph g[data-edge-id="photos.sendingPhoto-uploadFailed-photos.waitingForRetry"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sent).toEqual([
      {
        kind: "event",
        event: "uploadFailed",
        payload: { reason: "offline" },
        actor: { map: "photos", key: "p1" },
      },
    ]);
  });
});
