// @vitest-environment happy-dom
import type { VizLiveState, VizMachine } from "../schema.ts";
import { showPayloadSheet } from "./payload-sheet.ts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const text = (name: string) => ({
  name,
  type: "string",
  optional: false,
  doc: null,
  input: "text",
  choices: [],
  sample: `${name}@example.com`,
});

const machine = {
  id: "m",
  initial: "cart",
  regions: [],
  maps: [],
  states: [],
  events: [{ id: "pay", internal: false, doc: null, payload: [text("email"), text("name")] }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: null,
} as unknown as VizMachine;

const live = {
  state: "cart",
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

function stubViewport(height: number) {
  const target = Object.assign(new EventTarget(), { height, offsetTop: 0 });
  vi.stubGlobal("visualViewport", target);
  vi.stubGlobal("innerHeight", 844);
  return target;
}

function openPay() {
  const root = document.createElement("div");
  document.body.append(root);
  showPayloadSheet(root, { machine, live, composing: "pay", send: () => {}, compose: () => {} });
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("payload sheet keyboard: text inputs", () => {
  test("moving to the next input with the keyboard already open scrolls it into view", () => {
    stubViewport(544);
    const root = openPay();
    const inputs = root.querySelectorAll<HTMLInputElement>(".payload-sheet input");
    expect(inputs).toHaveLength(2);
    const second = inputs[1];
    const scroll = vi.fn();
    if (second) second.scrollIntoView = scroll;
    second?.focus();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  test("an input outside the sheet is not scrolled", () => {
    const viewport = stubViewport(844);
    openPay();
    const search = document.createElement("input");
    document.body.append(search);
    const scroll = vi.fn();
    search.scrollIntoView = scroll;
    search.focus();
    viewport.height = 544;
    viewport.dispatchEvent(new Event("resize"));
    expect(scroll).not.toHaveBeenCalled();
  });

  test("a visual viewport taller than the window gives no negative lift", () => {
    stubViewport(850);
    const root = openPay();
    expect(
      root.querySelector<HTMLElement>(".payload-sheet")?.style.getPropertyValue("--viz-keyboard"),
    ).toBe("0px");
  });
});
