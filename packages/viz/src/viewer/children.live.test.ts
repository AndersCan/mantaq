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

const event = (id: string) => ({ id, internal: false, doc: null, payload: null });

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
  test("the Step tab shows no child heading, and its cards sit in no fold", () => {
    const { root } = mount([child("p1", "sendingPhoto")]);
    expect(root.querySelector(".explore-map h3")).toBeNull();
    expect(root.querySelector(".explore-child")).not.toBeNull();
    expect(root.querySelector(".explore-map")?.closest("details")).toBeNull();
    expect(root.querySelector(".panel > .explore-map, .explore-live .explore-child")).toBeNull();
    expect(root.textContent).not.toContain("no children yet");
  });

  test("child rows and their Send buttons are in the Step tab", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "waitingForRetry")]);
    const rows = [...root.querySelectorAll(".explore [data-child-key]")];
    expect(rows.map((row) => row.getAttribute("data-child-key"))).toEqual(["p1", "p2"]);
    expect(root.querySelectorAll("[data-child-key][data-followed]")).toHaveLength(0);
    expect(rows[0]?.querySelector(".explore-child-now")?.textContent).toBe("p1: in sendingPhoto");
    const retry = root.querySelector('[data-actor="photos[p1]"] [data-send-item="retryPressed"]');
    expect(retry?.querySelector("[data-ignored]")).not.toBeNull();
    expect(
      root.querySelector(
        '[data-actor="photos[p1]"] [data-send-item="uploadConfirmed"] [data-ignored]',
      ),
    ).toBeNull();
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

  test("a child arrow with no child in its source has no Send button", () => {
    const { root } = mount([child("p1", "waitingForRetry")]);
    click(edgeGroup(root));
    expect(root.querySelector("[data-selected-edge]")).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
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

  test("every child has its own Send buttons and a press moves only that child", () => {
    const { root, sent } = mount([child("p1", "sendingPhoto"), child("p2", "sendingPhoto")]);
    expect(root.querySelectorAll("li.explore-child")).toHaveLength(2);
    click(root.querySelector('[data-actor="photos[p2]"] [data-send="uploadConfirmed"]'));
    expect(sent).toHaveLength(1);
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
    click(root.querySelector('[data-actor="photos[p2]"] [data-send="uploadConfirmed"]'));
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

  test("after a Send press the Step tab starts with what was sent, to the child", () => {
    const { root } = mount([child("p1", "waitingForRetry")], photoQueue, () => ({
      ...stepOf("retryPressed", "photos.waitingForRetry", "photos.waitingForRetry", "stay"),
      actor: { map: "photos", key: "p1" },
    }));
    expect(root.querySelector("[data-live-sent-event]")).toBeNull();
    sendFrom(root, "p1", "retryPressed");
    const outcome = root.querySelector(".explore-outcome");
    expect(outcome?.firstElementChild?.textContent).toBe("Sent retryPressed to p1");
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

    const afterAdd1 = { children: [child("p1", "sendingPhoto", 1)] };

    test("a repeated Send button click sends the next free key", () => {
      const keyed: VizMachine = {
        ...withPhotoAdded,
        events: [
          {
            ...event("photoAdded"),
            payload: [
              {
                name: "photoId",
                type: "string",
                optional: false,
                doc: null,
                input: "text",
                choices: [],
                sample: "p1",
              },
            ],
          },
          event("queueCleared"),
        ],
      };
      const root = document.createElement("div");
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([]);
        },
        step: (step) => {
          sent = [...sent, step];
          return { ...live([child("p1", "sendingPhoto", 1)], sent), last: rootStay("photoAdded") };
        },
      };
      mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [keyed] }, { driver });
      clickSend(root, "photoAdded");
      expect(sent).toEqual([{ kind: "event", event: "photoAdded", payload: { photoId: "p1" } }]);
      clickSend(root, "photoAdded");
      expect(sent.at(-1)).toEqual({
        kind: "event",
        event: "photoAdded",
        payload: { photoId: "p2" },
      });
    });

    test("a click sends the next key when the evidence is only in a removed child", () => {
      const keyed: VizMachine = {
        ...withPhotoAdded,
        events: [
          {
            ...event("photoAdded"),
            payload: [
              {
                name: "photoId",
                type: "string",
                optional: false,
                doc: null,
                input: "text",
                choices: [],
                sample: "p1",
              },
            ],
          },
          event("queueCleared"),
        ],
      };
      const root = document.createElement("div");
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([]);
        },
        step: (step) => {
          sent = [...sent, step];
          return {
            ...live([child("p1", "sendingPhoto", 2)], sent),
            removed: [{ ...child("p1", "sendingPhoto", 1), until: 2 }],
            last: rootStay("photoAdded"),
          };
        },
      };
      mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [keyed] }, { driver });
      clickSend(root, "photoAdded");
      clickSend(root, "photoAdded");
      expect(sent.at(-1)).toEqual({
        kind: "event",
        event: "photoAdded",
        payload: { photoId: "p2" },
      });
    });

    test("an event that declares no fields sends the next free key too", () => {
      const bare: VizMachine = {
        ...withPhotoAdded,
        events: [{ ...event("photoAdded"), payload: [] }, event("queueCleared")],
        fuzz: {
          seed: 1,
          iterations: 1,
          corpus: [
            {
              steps: [{ kind: "event", event: "photoAdded", payload: { photoId: "p1" } }],
              discovered: [],
            },
          ],
          errors: [],
          failedExpectations: [],
        } as unknown as VizMachine["fuzz"],
      };
      const root = document.createElement("div");
      let sent: VizStep[] = [];
      const driver: VizDriver = {
        reset: () => {
          sent = [];
          return live([]);
        },
        step: (step) => {
          sent = [...sent, step];
          return { ...live([child("p1", "sendingPhoto", 1)], sent), last: rootStay("photoAdded") };
        },
      };
      mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [bare] }, { driver });
      clickSend(root, "photoAdded");
      expect(sent).toEqual([{ kind: "event", event: "photoAdded", payload: { photoId: "p1" } }]);
      clickSend(root, "photoAdded");
      expect(sent.at(-1)).toEqual({
        kind: "event",
        event: "photoAdded",
        payload: { photoId: "p2" },
      });
    });

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

    const childMoved = (key: string, from: string, to: string): VizLiveStep => ({
      ...stepOf("photoAdded", `photos.${from}`, `photos.${to}`, "transition"),
      actor: { map: "photos", key },
    });
    const rootMoved: VizLiveStep = {
      ...stepOf("photoDone", "showingQueue", "showingQueue", "transition"),
      actor: undefined,
    };

    test("the panel says a child took the event; the step's own part came back", () => {
      const root = scripted(
        [
          {
            children: [],
            last: rootStay("photoAdded"),
            after: [childMoved("p1", "sendingPhoto", "photoSent"), rootMoved],
          },
        ],
        ["photoAdded"],
      );
      const entries = [...root.querySelectorAll("[data-live-after] > p.muted")].map(
        (each) => each.textContent,
      );
      expect(entries).toEqual([
        "Then p1 took photoAdded: sendingPhoto → photoSent",
        "Then photoDone came back",
      ]);
    });

    test("the root is named by the machine when a child's step moved it", () => {
      const root = scripted(
        [
          {
            children: [],
            last: childMoved("p1", "sendingPhoto", "photoSent"),
            after: [rootMoved],
          },
        ],
        ["photoAdded"],
      );
      expect(root.querySelector("[data-live-after] > p.muted")?.textContent).toBe(
        "Then photoQueue took photoDone: showingQueue → showingQueue",
      );
    });
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
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p2]"] [data-send="retryPressed"]')
      ?.click();
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
    root
      .querySelector<HTMLButtonElement>('[data-actor="photos[p1]"] [data-send="uploadFailed"]')
      ?.click();
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
  root.querySelector<HTMLButtonElement>('[data-send="paused"]')?.click();
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
