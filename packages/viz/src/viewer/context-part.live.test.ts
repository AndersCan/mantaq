// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizEvent,
  VizLiveState,
  VizMachine,
  VizState,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";

const stateOf = (id: string, initial = false): VizState => ({
  id,
  label: id,
  region: id.includes(".") ? id.slice(0, id.indexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edgeOf = (from: string, event: string, to: string): VizEdge => ({
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
});

const eventOf = (id: string, field: string): VizEvent => ({
  id,
  internal: false,
  doc: null,
  payload: [
    {
      name: field,
      type: "string",
      optional: false,
      doc: null,
      input: "text",
      choices: [],
      sample: "s",
    },
  ],
});

/** Machines p and q beside idle: p's arrow carries `code`, q's carries `why`. */
const board: VizMachine = {
  id: "app",
  initial: "idle",
  regions: ["p", "q"],
  maps: [],
  actors: ["p", "q"],
  states: [
    stateOf("idle", true),
    ...["p", "q"].flatMap((a) => [stateOf(`${a}.one`, true), stateOf(`${a}.two`)]),
  ],
  events: [eventOf("x", "code"), eventOf("y", "why")],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edgeOf("p.one", "x", "p.two"), edgeOf("q.one", "y", "q.two")],
  fuzz: null,
  runs: [],
};

const live = (): VizLiveState => ({
  state: "idle",
  steps: [],
  last: null,
  after: [],
  timers: [],
  context: {},
  payload: null,
  regions: { p: "p.one", q: "q.one" },
  children: [],
  effectMode: "held",
  waiting: [],
});

afterEach(() => document.body.replaceChildren());

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  const driver: VizDriver = {
    reset: live,
    step: live,
    listen: () => {},
    dryRun: (c) => c.map(() => null),
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [board] }, { driver });
  return root;
}

const press = (element: Element | null) =>
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
function fields(root: HTMLElement): Array<string | undefined> {
  const boxes = [...root.querySelectorAll("[data-send-form] [data-value]")];
  return boxes.map((input) => input.getAttribute("data-value") ?? undefined);
}

test("in an opened machine, an arrow's send form lists its own event's fields", () => {
  const root = mount();
  press(root.querySelector('g.part[data-part="p"]'));
  press(root.querySelector('[data-details-edge="p.one-x-p.two"]'));
  expect(fields(root)).toEqual(["code"]);
  press(root.querySelector(".focus-path button"));
  press(root.querySelector('g.part[data-part="q"]'));
  press(root.querySelector('[data-details-edge="q.one-y-q.two"]'));
  expect(fields(root)).toEqual(["why"]);
});
