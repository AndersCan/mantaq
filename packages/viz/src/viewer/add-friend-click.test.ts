// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";

/** justus add-friend-machine: the guards, copied. */
type Friend = { identity: string; name: string };
type Model = { at: string; choices: Friend[]; ticked: string[] };

function friendChoices(friends: Friend[], members: string[]): Friend[] {
  return friends.filter((f) => !members.includes(f.identity));
}

function move(model: Model, step: VizStep): Model {
  if (step.kind !== "event") return model;
  const payload = (step.payload ?? {}) as Record<string, VizJson>;
  if (step.event === "openPicker" && ["showingPeopleWithAddFriend"].includes(model.at)) {
    const choices = friendChoices(
      payload.friends as Friend[],
      payload.memberIdentities as string[],
    );
    return choices.length === 0
      ? { at: "showingPeopleWithAddFriend", choices: [], ticked: [] }
      : { at: "choosingFriends", choices, ticked: [] };
  }
  if (step.event === "toggleFriend" && model.at === "choosingFriends") {
    const identity = payload.identity as string;
    if (!model.choices.some((c) => c.identity === identity)) return model;
    const ticked = model.ticked.includes(identity)
      ? model.ticked.filter((id) => id !== identity)
      : [...model.ticked, identity];
    return { ...model, ticked };
  }
  if (step.event === "pickRole" && model.at === "choosingFriends") {
    return model.ticked.length === 0 ? model : { ...model, at: "askingFriends" };
  }
  return model;
}

const start: Model = { at: "showingPeopleWithAddFriend", choices: [], ticked: [] };

function fakeDriver() {
  const sent: VizStep[] = [];
  const run = (steps: ReadonlyArray<VizStep>) => {
    let model = start;
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      const from = model.at;
      model = move(model, step);
      last = {
        from,
        event: step.kind === "event" ? step.event : "",
        to: model.at,
        outcome:
          from === model.at && step.kind === "event" && step.event === "pickRole"
            ? "stay"
            : "transition",
        effects: [],
        sent: [],
        context: { ticked: model.ticked },
        error: null,
      };
    }
    const live: VizLiveState = {
      state: model.at,
      steps: [...steps],
      last,
      after: [],
      timers: [],
      context: { ticked: model.ticked },
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
    };
    return { live, last, model };
  };
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return run([]).live;
    },
    step: (step) => {
      sent.push(step);
      return run(sent).live;
    },
    listen: () => {},
    dryRun: (candidates) => candidates.map((each) => run([...sent, each]).last),
  };
  return { driver, sent, now: () => run(sent).model };
}

const text = (
  name: string,
  input: VizField["input"] = "text",
  sample: VizJson = "sample",
): VizField => ({
  name,
  type: "string",
  optional: false,
  doc: null,
  input,
  choices: input === "choice" ? ["reader", "member"] : [],
  sample,
});

const stateOf = (id: string, initial = false): VizState => ({
  id,
  label: id,
  region: null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

function edgeOf(from: string, event: string, to: string): VizEdge {
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

const person = (identity: string): Friend => ({ identity, name: identity });
const album = { albumName: "Lisbon trip", folderId: "f1" };
const open = (friends: string[], members: string[]): VizStep => ({
  kind: "event",
  event: "openPicker",
  payload: { ...album, friends: friends.map(person), memberIdentities: members },
});
const toggle = (identity: string): VizStep => ({
  kind: "event",
  event: "toggleFriend",
  payload: { identity },
});
const role: VizStep = { kind: "event", event: "pickRole", payload: { role: "member" } };
const SHOWING = "showingPeopleWithAddFriend";

const addFriend: VizMachine = {
  id: "addFriend",
  initial: SHOWING,
  regions: [],
  maps: [],
  actors: [],
  states: [stateOf(SHOWING, true), stateOf("choosingFriends"), stateOf("askingFriends")],
  events: [
    {
      id: "openPicker",
      internal: false,
      doc: null,
      payload: [
        text("folderId"),
        text("albumName"),
        text("friends", "json", [person("sample")]),
        text("memberIdentities", "json", ["sample"]),
      ],
    },
    { id: "toggleFriend", internal: false, doc: null, payload: [text("identity")] },
    { id: "pickRole", internal: false, doc: null, payload: [text("role", "choice", "reader")] },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    edgeOf(SHOWING, "openPicker", SHOWING),
    edgeOf(SHOWING, "openPicker", "choosingFriends"),
    edgeOf("choosingFriends", "toggleFriend", "choosingFriends"),
    edgeOf("choosingFriends", "pickRole", "askingFriends"),
  ],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    errors: [],
    failedExpectations: [],
    expectations: [],
    messages: [],
    corpus: [
      {
        steps: [open(["a", "b"], ["a", "b"])],
        discovered: [`edge:${SHOWING}>openPicker>${SHOWING}`],
      },
      {
        steps: [open(["a", "b", "c"], ["a", "c"])],
        discovered: [`edge:${SHOWING}>openPicker>choosingFriends`],
      },
      {
        steps: [open(["k", "o", "a"], []), toggle("k"), role],
        discovered: [
          "edge:choosingFriends>pickRole>askingFriends",
          "edge:choosingFriends>toggleFriend>choosingFriends",
        ],
      },
    ],
  },
};

function mount(machine: VizMachine = addFriend, values: string[] = []) {
  const { driver, sent, now } = fakeDriver();
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver, values });
  return { root, sent, now };
}

const arrow = (root: HTMLElement, id: string) =>
  root.querySelector<SVGElement>(`[data-edge-id="${id}"]`);
const click = (root: HTMLElement, id: string) =>
  arrow(root, id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("addFriend clicked from the start", () => {
  test("openPicker, toggleFriend and pickRole each land where their arrow points", () => {
    const { root, sent, now } = mount();
    click(root, `${SHOWING}-openPicker-choosingFriends`);
    expect(now().at).toBe("choosingFriends");
    click(root, "choosingFriends-toggleFriend-choosingFriends");
    expect(now().ticked).toEqual(["k"]);
    click(root, "choosingFriends-pickRole-askingFriends");
    expect(now().at).toBe("askingFriends");
    expect(sent.map((step) => (step.kind === "event" ? step.event : ""))).toEqual([
      "openPicker",
      "toggleFriend",
      "pickRole",
    ]);
  });

  test("the self-loop arrow is not locked and stays in the list", () => {
    const { root, now } = mount();
    expect(arrow(root, `${SHOWING}-openPicker-${SHOWING}`)?.classList.contains("blocked")).toBe(
      false,
    );
    click(root, `${SHOWING}-openPicker-${SHOWING}`);
    expect(now().at).toBe(SHOWING);
  });

  test("with no friends set in Context, the arrow to choosingFriends is locked", () => {
    const { root, sent } = mount(addFriend, ["friends=[]"]);
    const to = arrow(root, `${SHOWING}-openPicker-choosingFriends`);
    expect(to?.classList.contains("blocked")).toBe(true);
    click(root, `${SHOWING}-openPicker-choosingFriends`);
    expect(sent).toHaveLength(0);
  });
});
