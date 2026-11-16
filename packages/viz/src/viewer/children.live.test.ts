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
import { sendVia } from "./send-via.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id.slice(id.lastIndexOf(".") + 1),
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

const event = (id: string, internal = false) => ({ id, internal, doc: null, payload: null });

const photoQueue: VizMachine = {
  id: "photoQueue",
  initial: "showingQueue",
  regions: ["photos"],
  maps: ["photos"],
  actors: [],
  states: [
    state("showingQueue", { initial: true }),
    state("photos.sendingPhoto", { initial: true }),
    state("photos.waitingForRetry"),
    state("photos.photoSent", { final: true }),
  ],
  events: [event("uploadConfirmed"), event("uploadFailed"), event("retryPressed")],
  outputs: [],
  partOutputs: {},
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

function stepOf(
  event: string,
  from: string,
  to: string,
  outcome: VizLiveStep["outcome"],
): VizLiveStep {
  return { from, event, to, outcome, effects: [], sent: [], context: null, error: null };
}

function sendFrom(root: HTMLElement, key: string, event: string) {
  root.querySelector<HTMLElement>(`li[data-child-key="${key}"]`)?.click();
  sendVia(root, event);
}

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
  test("the Step tab shows no child heading, and its cards sit in no fold", () => {
    const { root } = mount([child("p1", "sendingPhoto")]);
    expect(root.querySelector(".explore-map h3")).toBeNull();
    expect(root.querySelector(".explore-child")).not.toBeNull();
    expect(root.querySelector(".explore-map")?.closest("details")).toBeNull();
    expect(root.querySelector(".panel > .explore-map, .explore-live .explore-child")).toBeNull();
    expect(root.textContent).not.toContain("no children yet");
  });

  test("child rows are in the Step tab and clicking one sends nothing", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    const rows = [...root.querySelectorAll(".explore [data-child-key]")];
    expect(rows.map((row) => row.getAttribute("data-child-key"))).toEqual(["p1", "p2"]);
    expect(root.querySelectorAll("[data-child-key][data-followed]")).toHaveLength(0);
    expect(rows[0]?.querySelector(".explore-child-now")?.textContent).toBe("p1: in sendingPhoto");
    expect(rows[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector("[data-send]")).toBeNull();
    root.querySelector<HTMLElement>('li[data-child-key="p2"]')?.click();
    expect(sent).toEqual([]);
    const p2 = root.querySelector('li[data-child-key="p2"]');
    expect(p2?.hasAttribute("data-followed")).toBe(true);
    expect(p2?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-tab="step"]')?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector("[data-selected-edge]")).toBeNull();
  });

  test("Enter on a focused row follows that child", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    root
      .querySelector('li[data-child-key="p2"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(walkedKey(root)).toBe("p2");
    expect(sent).toEqual([]);
  });

  test("a final child's row can be followed too", () => {
    const { root } = mount([child("p1", "photoSent", 3)]);
    const row = root.querySelector('[data-child-key="p1"]');
    expect(row?.querySelector(".explore-child-now")?.textContent).toBe("p1: in photoSent (final)");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector('[data-child-key="p1"][data-followed]')).not.toBeNull();
  });

  test("a map without children has no section", () => {
    const { root } = mount([]);
    expect(root.querySelector(".explore-map")).toBeNull();
  });

  test("only the walked child's state is marked on the diagram", () => {
    const { root } = mount([child("p2", "waitingForRetry"), child("p1", "sendingPhoto")]);
    const current = [...root.querySelectorAll(".graph g.current")].map((each) =>
      each.getAttribute("data-node-id"),
    );
    expect(current.sort()).toEqual(["photos.sendingPhoto", "showingQueue"]);
  });

  const edgeGroup = (root: HTMLElement) =>
    root.querySelector<SVGGElement>(
      '.graph g[data-edge-id="photos.sendingPhoto-uploadConfirmed-photos.photoSent"]',
    );
  const click = (element: Element | null | undefined) =>
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const title = (root: HTMLElement) =>
    root.querySelector('.graph g.region[data-map="photos"] > text')?.textContent;
  const box = (root: HTMLElement, state: string) =>
    root.querySelector(`.graph g[data-node-id="photos.${state}"]`);
  const pick = (root: HTMLElement, key: string) =>
    click(root.querySelector(`.graph g.child-marker[data-marker-key="${key}"]`));
  const chips = (root: HTMLElement) =>
    Array.from(root.querySelectorAll(".graph g.child-marker")).map(
      (node) => `${node.getAttribute("data-marker-key")}@${node.getAttribute("data-marker-state")}`,
    );
  const walkedKey = (root: HTMLElement) =>
    root.querySelector("[data-child-key][data-followed]")?.getAttribute("data-child-key");

  test("each child is a chip on the state it is in; the frame title says one per key", () => {
    const { root } = mount([child("p1", "waitingForRetry"), child("p2", "sendingPhoto")]);
    expect(chips(root)).toEqual(["p1@photos.waitingForRetry", "p2@photos.sendingPhoto"]);
    expect(title(root)).toBe("photos: one per key");
    expect(chips(mount([]).root)).toEqual([]);
  });

  test("a child arrow's Details sends to the walked child", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    click(edgeGroup(root));
    const button = root.querySelector<HTMLButtonElement>("[data-send-edge]");
    expect(button?.textContent).toBe("Send uploadConfirmed to p1");
    button?.click();
    expect(sent).toEqual([
      {
        kind: "event",
        event: "uploadConfirmed",
        payload: null,
        actor: { map: "photos", key: "p1" },
      },
    ]);
  });

  test.each([
    ["transition", /^Sent uploadConfirmed to p1: .*sendingPhoto → .*waitingForRetry$/],
    ["stay", /^Sent uploadConfirmed to p1: handled in sendingPhoto, stays$/],
    ["ignored", /^Sent uploadConfirmed to p1: No handler for uploadConfirmed in .*sendingPhoto/],
  ] as const)(
    "after a child arrow's Details send, the Details say who got it and its %s",
    (outcome, text) => {
      const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
        ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.waitingForRetry", outcome),
        actor: { map: "photos", key: "p1" },
      }));
      click(edgeGroup(root));
      root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
      expect(root.querySelector("[data-details-sent]")?.textContent).toMatch(text);
    },
  );

  test("after a Details send that stays, the Send button is still there", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.waitingForRetry", "stay"),
      actor: { map: "photos", key: "p1" },
    }));
    click(edgeGroup(root));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(root.querySelector("[data-details-sent]")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(sent).toHaveLength(2);
  });

  test("a Details send the driver gives no outcome for shows no Details line", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto")]);
    click(edgeGroup(root));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(sent).toHaveLength(1);
    expect(root.querySelector("[data-details-sent]")).toBeNull();
    expect(root.querySelector("[data-send-edge]")).not.toBeNull();
  });

  test("after a Details send whose handler threw, the Details say so", () => {
    const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.sendingPhoto", "stay"),
      error: "upload failed",
      actor: { map: "photos", key: "p1" },
    }));
    click(edgeGroup(root));
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(root.querySelector("[data-details-sent]")?.parentElement?.textContent).toContain(
      "upload failed",
    );
  });

  test("a child arrow with no child in its source has no Send button", () => {
    const { root } = mount([child("p1", "waitingForRetry")]);
    click(edgeGroup(root));
    expect(root.querySelector("[data-selected-edge]")).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("a picked child in another state says so", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "waitingForRetry", 2)]);
    pick(two.root, "p2");
    click(edgeGroup(two.root));
    expect(two.root.querySelector("[data-blocked-note]")?.textContent).toBe(
      "uploadConfirmed can't be sent: p2 is in waitingForRetry, this arrow leaves sendingPhoto.",
    );
  });

  test("an arrow another part sends names it, has no Send and no lock", () => {
    const fed: VizMachine = { ...photoQueue, partOutputs: { other: ["uploadConfirmed"] } };
    const by = mount([child("p1", "sendingPhoto", 1)], fed);
    click(edgeGroup(by.root));
    expect(by.root.querySelector("[data-blocked-note]")?.textContent).toBe(
      "uploadConfirmed is sent by other, not by hand.",
    );
    expect(by.root.querySelector("[data-send-edge]")).toBeNull();
    expect(by.root.querySelector(".blocked-lock")).toBeNull();
  });

  test("a map with no child has no Send button on its arrows", () => {
    const { root } = mount([]);
    click(edgeGroup(root));
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("a click on a child state selects it, sends nothing and keeps the followed child", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    pick(root, "p1");
    click(box(root, "waitingForRetry"));
    expect(walkedKey(root)).toBe("p1");
    expect(sent).toEqual([]);
    expect(root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
    expect(box(root, "waitingForRetry")?.classList.contains("selected")).toBe(true);
  });

  test("a click on a child state with no child in it shows details and keeps the pick", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    pick(root, "p2");
    click(box(root, "photoSent"));
    expect(sent).toEqual([]);
    expect(walkedKey(root)).toBe("p2");
    expect(root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
  });

  test("a chip click follows that child, shows the Step tab and sends nothing", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    click(box(root, "photoSent"));
    pick(root, "p2");
    expect(walkedKey(root)).toBe("p2");
    expect(root.querySelector('[data-tab="step"]')?.getAttribute("aria-selected")).toBe("true");
    expect(
      root.querySelector('g.child-marker[data-marker-key="p2"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    pick(root, "p2");
    expect(walkedKey(root)).toBe("p2");
    expect(sent).toEqual([]);
  });

  test("a chip click clears the selection and marks the row; the Step count stays", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    click(box(root, "sendingPhoto"));
    expect(root.querySelector(".graph .selected")).not.toBeNull();
    pick(root, "p2");
    expect(root.querySelector(".graph .selected")).toBeNull();
    expect(root.querySelector('[data-child-key="p2"][data-followed]')).not.toBeNull();
    expect(root.querySelector('[data-child-key="p1"][data-followed]')).toBeNull();
    expect(sent).toEqual([]);
  });

  test("a row press follows its child, and Send in Details moves only that child", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    expect(root.querySelectorAll("li.explore-child")).toHaveLength(2);
    sendFrom(root, "p2", "uploadConfirmed");
    expect(sent).toEqual([
      {
        kind: "event",
        event: "uploadConfirmed",
        payload: null,
        actor: { map: "photos", key: "p2" },
      },
    ]);
  });

  test("the frame title stays one per key without a driver", () => {
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [photoQueue] });
    expect(title(root)).toBe("photos: one per key");
    expect(root.querySelector(".graph g.child-marker")).toBeNull();
    click(box(root, "sendingPhoto"));
    expect(root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
  });

  test("an arrow with no walked child in its state does nothing", () => {
    const none = mount([child("p1", "waitingForRetry")]);
    click(edgeGroup(none.root));
    expect(none.sent).toEqual([]);
  });

  test("with a child walked, another child's arrow is not next and its click shows details", () => {
    const two = mount([child("p1", "sendingPhoto", 1), child("p2", "waitingForRetry", 2)]);
    pick(two.root, "p2");
    click(edgeGroup(two.root));
    expect(two.sent).toEqual([]);
    expect(two.root.querySelector('[data-tab="details"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  test("a walked child that is gone falls back to the lowest key", () => {
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
    pick(root, "p2");
    expect(walkedKey(root)).toBe("p2");
    sendFrom(root, "p2", "uploadConfirmed");
    expect(walkedKey(root)).toBeUndefined();
    expect(chips(root)).toEqual(["p1@photos.sendingPhoto"]);
  });

  test("a child move reads the key and the move", () => {
    const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.photoSent", "transition"),
      actor: { map: "photos", key: "p1" },
    }));
    sendFrom(root, "p1", "uploadConfirmed");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "uploadConfirmed: p1 sendingPhoto → photoSent",
    );
  });

  test("a child that handled the event and stayed reads handled in", () => {
    const { root } = mount([child("p1", "waitingForRetry")], photoQueue, () => ({
      ...stepOf("retryPressed", "photos.waitingForRetry", "photos.waitingForRetry", "stay"),
      actor: { map: "photos", key: "p1" },
    }));
    sendFrom(root, "p1", "retryPressed");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "retryPressed: p1 handled in waitingForRetry, stays",
    );
  });

  test("with two maps the map name shows", () => {
    const two: VizMachine = { ...photoQueue, maps: ["photos", "videos"] };
    const { root } = mount([child("p1", "sendingPhoto")], two, () => ({
      ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.photoSent", "transition"),
      actor: { map: "photos", key: "p1" },
    }));
    sendFrom(root, "p1", "uploadConfirmed");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "uploadConfirmed: photos p1 sendingPhoto → photoSent",
    );
  });

  test("a missing child reads that it is not in the map", () => {
    const { root } = mount([child("p1", "sendingPhoto")], photoQueue, () => ({
      ...stepOf("uploadConfirmed", "", "", "missing"),
      actor: { map: "photos", key: "p9" },
    }));
    sendFrom(root, "p1", "uploadConfirmed");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "p9 is not in photos. Nothing ran.",
    );
  });

  test("a payload event for a child sends to that child at once", () => {
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
    pick(root, "p2");
    sendFrom(root, "p2", "retryPressed");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "event",
      event: "retryPressed",
      actor: { map: "photos", key: "p2" },
    });
  });

  test("a payload event sends the example to the child in its source at once", () => {
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
    sendFrom(root, "p1", "uploadFailed");
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

test("a click on a root state whose name starts with the map's sends nothing; its Send button does", () => {
  const machine: VizMachine = {
    ...photoQueue,
    states: [...photoQueue.states, state("photosPaused")],
    events: [...photoQueue.events, event("paused")],
    edges: [...photoQueue.edges, edge("showingQueue", "paused", "photosPaused")],
  };
  const { root, sent } = mount([child("p1", "sendingPhoto")], machine);
  root
    .querySelector('.graph g[data-node-id="photosPaused"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(sent).toEqual([]);
  sendVia(root, "paused");
  expect(sent).toMatchObject([{ kind: "event", event: "paused" }]);
});

test("each map's children are chips on that map's own states", () => {
  const machine: VizMachine = {
    ...photoQueue,
    regions: ["photos", "uploads"],
    maps: ["photos", "uploads"],
    states: [...photoQueue.states, state("uploads.queued", { initial: true })],
  };
  const upload: VizLiveChild = { map: "uploads", key: "u1", state: "uploads.queued", since: 0 };
  const { root } = mount([child("p1", "sendingPhoto"), upload], machine);
  const listed = (map: string) =>
    Array.from(root.querySelectorAll(`.graph g.child-marker[data-marker-map="${map}"]`)).map(
      (node) => `${node.getAttribute("data-marker-key")}@${node.getAttribute("data-marker-state")}`,
    );
  expect(listed("photos")).toEqual(["p1@photos.sendingPhoto"]);
  expect(listed("uploads")).toEqual(["u1@uploads.queued"]);
});

test("each map's Step section lists only its own children; the followed mark stays in its map", () => {
  const machine: VizMachine = {
    ...photoQueue,
    regions: ["photos", "uploads"],
    maps: ["photos", "uploads"],
    states: [...photoQueue.states, state("uploads.queued", { initial: true })],
  };
  const upload: VizLiveChild = { map: "uploads", key: "p1", state: "uploads.queued", since: 0 };
  const { root } = mount([child("p1", "sendingPhoto"), upload], machine);
  const rows = (map: string) =>
    Array.from(root.querySelectorAll(`.explore-map[data-map="${map}"] li.explore-child`)).map(
      (row) => `${row.getAttribute("data-child-key")}@${row.getAttribute("data-child-state")}`,
    );
  expect(rows("photos")).toEqual(["p1@photos.sendingPhoto"]);
  expect(rows("uploads")).toEqual(["p1@uploads.queued"]);
  root
    .querySelector('.graph g.child-marker[data-marker-map="photos"][data-marker-key="p1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const followed = Array.from(root.querySelectorAll("li.explore-child[data-followed]"));
  expect(followed.map((row) => row.getAttribute("data-child-map"))).toEqual(["photos"]);
});
