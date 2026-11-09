// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveChild,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizRemovedChild,
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

function stepOf(
  event: string,
  from: string,
  to: string,
  outcome: VizLiveStep["outcome"],
): VizLiveStep {
  return { from, event, to, outcome, effects: [], sent: [], context: null, error: null };
}

function sendFrom(root: HTMLElement, key: string, event: string) {
  root
    .querySelector<HTMLButtonElement>(`[data-actor="photos[${key}]"] [data-send="${event}"]`)
    ?.click();
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
  test("the Step tab shows no child heading or cards outside the fold", () => {
    const { root } = mount([child("p1", "sendingPhoto")]);
    expect(root.querySelector(".explore-map h3")).toBeNull();
    expect(root.querySelector(".explore-child")).not.toBeNull();
    expect(root.querySelector(".explore-map")?.closest("details[data-events]")).not.toBeNull();
    expect(root.querySelector(".panel > .explore-map, .explore-live .explore-child")).toBeNull();
    expect(root.textContent).not.toContain("no children yet");
  });

  test("child rows and their Send buttons are inside Events and time", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    const fold = root.querySelector("details[data-events]");
    const rows = [...(fold?.querySelectorAll("[data-child-key]") ?? [])];
    expect(rows.map((row) => row.getAttribute("data-child-key"))).toEqual(["p1", "p2"]);
    expect(root.querySelectorAll("[data-child-key]")).toHaveLength(2);
    expect(rows[0]?.querySelector(".explore-child-now")?.textContent).toBe("p1: in sendingPhoto");
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

  test("a final child has no moves block", () => {
    const { root } = mount([child("p1", "photoSent", 3)]);
    const row = root.querySelector('[data-child-key="p1"]');
    expect(row?.querySelector(".explore-child-now")?.textContent).toBe("p1: in photoSent (final)");
    expect(row?.querySelector("[data-actor]")).toBeNull();
  });

  test("a map without children has no section", () => {
    const { root } = mount([]);
    expect(root.querySelector(".explore-map")).toBeNull();
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

  describe("the log names starts and removals", () => {
    const withPhotoAdded: VizMachine = {
      ...photoQueue,
      events: [...photoQueue.events, event("photoAdded"), event("queueCleared")],
    };
    const removedChild = (key: string, at: number, until: number): VizRemovedChild => ({
      ...child(key, "sendingPhoto", at),
      until,
    });
    // frames[n] is the state after n steps; the driver answers from it by step count.
    function scripted(frames: Array<Partial<VizLiveState>>, steps: string[] = []) {
      const root = document.createElement("div");
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([]);
        },
        step: (step) => {
          sent = [...sent, step];
          const frame = frames[sent.length - 1] ?? {};
          return { ...live([], sent), ...frame, last: frame.last ?? rootStay("photoAdded") };
        },
      };
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withPhotoAdded] },
        { driver, steps },
      );
      return root;
    }
    const rootStay = (name: string): VizLiveStep =>
      stepOf(name, "showingQueue", "showingQueue", "stay");
    const clickSend = (root: HTMLElement, id: string) =>
      root.querySelector<HTMLButtonElement>(`[data-send="${id}"]`)?.click();
    const pathTexts = (root: HTMLElement) =>
      [...root.querySelectorAll("[data-rewind]")].map((b) => b.textContent);

    const afterAdd1 = { children: [child("p1", "sendingPhoto", 1)] };
    const afterAdd2 = {
      children: [child("p1", "sendingPhoto", 1), child("p2", "sendingPhoto", 2)],
    };

    test("a step that starts a child says so", () => {
      const root = scripted([afterAdd1]);
      clickSend(root, "photoAdded");
      const line = root.querySelector("[data-live-started]");
      expect(line?.textContent).toBe("p1 started in sendingPhoto");
      expect(JSON.parse(line?.getAttribute("data-keys") ?? "")).toEqual(["p1"]);
      expect(root.querySelector("[data-live-removed]")).toBeNull();
    });

    test("a root stay that starts a child shows both lines", () => {
      const root = scripted([afterAdd1]);
      clickSend(root, "photoAdded");
      expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
        "photoAdded: handled in showingQueue, stays",
      );
      expect(root.querySelector("[data-live-started]")).not.toBeNull();
    });

    test("children grouped by state in order of first appearance", () => {
      const root = scripted([
        {
          children: [
            child("p1", "sendingPhoto", 1),
            child("p2", "sendingPhoto", 1),
            child("p3", "photoSent", 1),
          ],
        },
      ]);
      clickSend(root, "photoAdded");
      expect(root.querySelector("[data-live-started]")?.textContent).toBe(
        "p1, p2 started in sendingPhoto; p3 started in photoSent",
      );
    });

    test("a step that removes children names them all", () => {
      const root = scripted([
        afterAdd1,
        {},
        {
          children: [],
          removed: ["p1", "p2", "p3", "p4"].map((key) => removedChild(key, 1, 3)),
        },
      ]);
      clickSend(root, "photoAdded");
      clickSend(root, "photoAdded");
      clickSend(root, "photoAdded");
      const line = root.querySelector("[data-live-removed]");
      expect(line?.textContent).toBe("p1, p2, p3, p4 removed");
      expect(JSON.parse(line?.getAttribute("data-keys") ?? "")).toEqual(["p1", "p2", "p3", "p4"]);
    });

    test("children before the first step get no line", () => {
      const { root } = mount([child("p1", "sendingPhoto", 0)]);
      expect(root.querySelector("[data-live-started]")).toBeNull();
      expect(root.querySelector("[data-live-removed]")).toBeNull();
    });

    test("a child started and a child removed in one step show both lines, started first", () => {
      const root = scripted([
        afterAdd1,
        {
          children: [child("p2", "sendingPhoto", 2)],
          removed: [removedChild("p1", 1, 2)],
        },
      ]);
      clickSend(root, "photoAdded");
      clickSend(root, "photoAdded");
      const lines = [...root.querySelectorAll("[data-live-started], [data-live-removed]")];
      expect(lines.map((line) => line.textContent)).toEqual([
        "p2 started in sendingPhoto",
        "p1 removed",
      ]);
    });

    const FULL = [
      'photoAdded={"photoId":"p1"}',
      'photoAdded={"photoId":"p2"}',
      "photos[p1]>uploadConfirmed",
      "queueCleared",
    ];
    const FULL_FRAMES: Array<Partial<VizLiveState>> = [
      afterAdd1,
      afterAdd2,
      {
        children: [child("p1", "photoSent", 1), child("p2", "sendingPhoto", 2)],
        last: {
          ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.photoSent", "transition"),
          actor: { map: "photos", key: "p1" },
        },
      },
      {
        children: [],
        removed: [removedChild("p1", 1, 4), removedChild("p2", 2, 4)],
        last: rootStay("queueCleared"),
      },
    ];

    test("Path entries name starts, moves and removals", () => {
      const root = scripted(FULL_FRAMES, FULL);
      expect(pathTexts(root)).toEqual([
        "start",
        "photoAdded {photoId p1} → p1 started",
        "photoAdded {photoId p2} → p2 started",
        "uploadConfirmed: p1 sendingPhoto → photoSent",
        "queueCleared → p1, p2 removed",
      ]);
    });

    test("a stay and an ignored child step read in the Path", () => {
      const at = { map: "photos", key: "p1" };
      const root = scripted(
        [
          afterAdd1,
          {
            ...afterAdd1,
            last: {
              ...stepOf("retryPressed", "photos.sendingPhoto", "photos.sendingPhoto", "stay"),
              actor: at,
            },
          },
          {
            ...afterAdd1,
            last: { ...stepOf("uploadConfirmed", "photos.sendingPhoto", "", "ignored"), actor: at },
          },
          {
            ...afterAdd1,
            last: {
              ...stepOf("uploadConfirmed", "", "", "missing"),
              actor: { map: "photos", key: "p9" },
            },
          },
        ],
        [
          "photoAdded",
          "photos[p1]>retryPressed",
          "photos[p1]>uploadConfirmed",
          "photos[p9]>uploadConfirmed",
        ],
      );
      expect(pathTexts(root).slice(2)).toEqual([
        "retryPressed: p1 stays in sendingPhoto",
        "uploadConfirmed: p1, nothing ran",
        "uploadConfirmed: p9, nothing ran",
      ]);
    });

    test("more than 3 removed are cut in Path with the full list in its title", () => {
      const keys = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"];
      const root = scripted(
        [
          {
            children: [],
            removed: keys.map((key) => removedChild(key, 0, 1)),
            last: rootStay("queueCleared"),
          },
        ],
        ["queueCleared"],
      );
      const entry = root.querySelector('[data-rewind="1"]');
      expect(entry?.textContent).toBe("queueCleared → p1, p2, p3 and 9 more removed");
      expect(entry?.getAttribute("title")).toBe(`queueCleared → ${keys.join(", ")} removed`);
      expect(root.querySelector("[data-live-removed]")?.textContent).toBe(
        `${keys.join(", ")} removed`,
      );
    });

    test("a step the driver throws on leaves the next Path entry with its own outcome", () => {
      const root = document.createElement("div");
      let calls = 0;
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([child("p1", "sendingPhoto", 0)]);
        },
        step: (step) => {
          calls += 1;
          if (calls === 1) throw new Error("boom");
          sent = [...sent, step];
          return {
            ...live([child("p1", "photoSent", 0)], sent),
            last: {
              ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.photoSent", "transition"),
              actor: { map: "photos", key: "p1" },
            },
          };
        },
      };
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withPhotoAdded] },
        { driver },
      );
      sendFrom(root, "p1", "uploadConfirmed");
      sendFrom(root, "p1", "uploadConfirmed");
      expect(pathTexts(root)).toEqual(["start", "uploadConfirmed: p1 sendingPhoto → photoSent"]);
    });

    test("an advance that fires nothing leaves later Path entries with their own outcomes", () => {
      const root = document.createElement("div");
      const moves = [
        {
          ...stepOf("uploadFailed", "photos.sendingPhoto", "photos.waitingForRetry", "transition"),
        },
        {
          ...stepOf("retryPressed", "photos.waitingForRetry", "photos.sendingPhoto", "transition"),
        },
      ];
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([child("p1", "sendingPhoto", 0)]);
        },
        step: (step) => {
          sent = [...sent, step];
          if (step.kind === "advance") return live([child("p1", "sendingPhoto", 0)], sent);
          const done = sent.filter((each) => each.kind === "event").length;
          return {
            ...live([child("p1", "sendingPhoto", 0)], sent),
            last: { ...moves[done - 1]!, actor: { map: "photos", key: "p1" } },
          };
        },
      };
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withPhotoAdded] },
        { driver },
      );
      root.querySelector<HTMLButtonElement>("[data-advance]")?.click();
      sendFrom(root, "p1", "uploadFailed");
      sendFrom(root, "p1", "retryPressed");
      const expected = [
        "start",
        "advance 100 ms",
        "uploadFailed: p1 sendingPhoto → waitingForRetry",
        "retryPressed: p1 waitingForRetry → sendingPhoto",
      ];
      expect(pathTexts(root)).toEqual(expected);
      root.querySelector<HTMLButtonElement>('[data-rewind="3"]')?.click();
      expect(pathTexts(root)).toEqual(expected);
    });

    test("with two maps the Path entry shows the map name", () => {
      const two: VizMachine = { ...photoQueue, maps: ["photos", "videos"] };
      const { root } = mount([child("p1", "sendingPhoto")], two, () => ({
        ...stepOf("uploadConfirmed", "photos.sendingPhoto", "photos.photoSent", "transition"),
        actor: { map: "photos", key: "p1" },
      }));
      sendFrom(root, "p1", "uploadConfirmed");
      expect(pathTexts(root).at(-1)).toBe("uploadConfirmed: photos p1 sendingPhoto → photoSent");
    });

    test("a short Path entry has no title", () => {
      const root = scripted([afterAdd1], ["photoAdded"]);
      expect(root.querySelector('[data-rewind="1"]')?.hasAttribute("title")).toBe(false);
    });

    test("an array payload reads as JSON in the Path", () => {
      const root = scripted([afterAdd1], ['photoAdded=["a","b"]']);
      expect(pathTexts(root).at(-1)).toBe('photoAdded ["a","b"] → p1 started');
    });

    test("four removed keys are cut to three and a count", () => {
      const keys = ["p1", "p2", "p3", "p4"];
      const root = scripted(
        [
          {
            children: [],
            removed: keys.map((key) => removedChild(key, 0, 1)),
            last: rootStay("queueCleared"),
          },
        ],
        ["queueCleared"],
      );
      expect(root.querySelector('[data-rewind="1"]')?.textContent).toBe(
        "queueCleared → p1, p2, p3 and 1 more removed",
      );
    });

    test("Back rebuilds the Path texts", () => {
      const root = scripted(FULL_FRAMES, FULL);
      root.querySelector<HTMLButtonElement>('[data-rewind="3"]')?.click();
      expect(pathTexts(root)).toEqual([
        "start",
        "photoAdded {photoId p1} → p1 started",
        "photoAdded {photoId p2} → p2 started",
        "uploadConfirmed: p1 sendingPhoto → photoSent",
      ]);
      clickSend(root, "queueCleared");
      expect(pathTexts(root).at(-1)).toBe("queueCleared → p1, p2 removed");
    });
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
