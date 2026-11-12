// @vitest-environment happy-dom
import type { VizLiveState, VizMachine } from "../schema.ts";
import { showPayloadSheet } from "./payload-sheet.ts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const machine: VizMachine = {
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

function stubViewport(height: number, offsetTop = 0) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  target.height = height;
  target.offsetTop = offsetTop;
  vi.stubGlobal("visualViewport", target);
  vi.stubGlobal("innerHeight", 844);
  return target;
}

afterEach(() => vi.unstubAllGlobals());

describe("payload sheet and the on-screen keyboard", () => {
  test("the sheet follows the visual viewport and stops when closed", () => {
    const viewport = stubViewport(844);
    const root = document.createElement("div");
    document.body.append(root);
    open(root, "go");
    const sheet = root.querySelector<HTMLElement>(".payload-sheet");
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("0px");
    viewport.height = 544;
    viewport.dispatchEvent(new Event("resize"));
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("300px");
    expect(sheet?.style.getPropertyValue("--viz-visible")).toBe("544px");
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event("scroll"));
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("260px");
    open(root, null);
    viewport.height = 444;
    viewport.dispatchEvent(new Event("resize"));
    expect(sheet?.style.getPropertyValue("--viz-keyboard")).toBe("260px");
    root.remove();
  });

  test("a focused field in the sheet is scrolled into view", () => {
    const viewport = stubViewport(844);
    const root = document.createElement("div");
    document.body.append(root);
    open(root, "go");
    const field = root.querySelector<HTMLElement>(".payload-sheet textarea, .payload-sheet input");
    const scroll = vi.fn();
    if (field) field.scrollIntoView = scroll;
    field?.focus();
    viewport.dispatchEvent(new Event("resize"));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    root.remove();
  });

  test("without a visual viewport the sheet opens with no keyboard variables", () => {
    vi.stubGlobal("visualViewport", undefined);
    const root = document.createElement("div");
    open(root, "go");
    expect(
      root.querySelector<HTMLElement>(".payload-sheet")?.style.getPropertyValue("--viz-keyboard"),
    ).toBe("");
  });
});
