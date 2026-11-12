// @vitest-environment happy-dom
import type { VizLiveState, VizMachine } from "../schema.ts";
import { showPayloadSheet } from "./payload-sheet.ts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const machine = {
  id: "m",
  initial: "idle",
  regions: [],
  maps: [],
  states: [],
  events: [{ id: "go", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: null,
} as unknown as VizMachine;

const live = {
  state: "idle",
  steps: [],
  last: null,
  after: [],
  timers: [],
  context: null,
  payload: null,
  regions: {},
  children: [],
  effectMode: "real",
  waiting: [],
} as VizLiveState;

function open(root: HTMLElement, composing: string | null) {
  showPayloadSheet(root, { machine, live, composing, send: () => {}, compose: () => {} });
}

afterEach(() => vi.unstubAllGlobals());

describe("payload sheet keyboard listeners on close", () => {
  test("a viewport scroll after the sheet closes changes nothing", () => {
    const viewport = Object.assign(new EventTarget(), { height: 544, offsetTop: 0 });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 844);
    const root = document.createElement("div");
    document.body.append(root);
    open(root, "go");
    const sheet = root.querySelector<HTMLElement>(".payload-sheet");
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("300px");
    open(root, null);
    viewport.offsetTop = 100;
    viewport.dispatchEvent(new Event("scroll"));
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("300px");
    root.remove();
  });
});
