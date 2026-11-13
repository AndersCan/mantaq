// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { systemOf } from "../system.ts";
import { renderSystem } from "./system.ts";

const state = (id: string, initial = false): VizState => ({
  id,
  label: id.slice(id.lastIndexOf(".") + 1),
  region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const edge = (from: string, event: string, to: string, emits: string[] = []): VizEdge => ({
  id: `${from}-${event}-${to}`,
  from,
  event,
  to,
  kind: "transition",
  origin: "declared",
  emits,
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});

/** Inbox (3 states) and a map of cooks (2) that talk to each other, and a lone `net` region. */
const board: VizMachine = {
  id: "team",
  initial: "empty",
  regions: ["cooks", "net"],
  maps: ["cooks"],
  states: [
    state("empty", true),
    state("holding"),
    state("full"),
    state("cooks.free", true),
    state("cooks.busy"),
    state("net.up", true),
  ],
  events: [],
  outputs: ["ASSIGNED"],
  partOutputs: { cooks: ["DONE"] },
  context: null,
  edges: [
    edge("empty", "ARRIVED", "holding", ["ASSIGNED"]),
    edge("holding", "DONE", "empty"),
    edge("cooks.free", "ASSIGNED", "cooks.busy", ["DONE"]),
    edge("net.up", "DROP", "net.up"),
  ],
  runs: [],
  fuzz: null,
};

const draw = (narrow: boolean) => {
  const svg = renderSystem(document, board, systemOf(board), { select: () => {}, narrow });
  const box = (selector: string) => {
    const rect = svg.querySelector(`${selector} rect`);
    return {
      x: Number(rect?.getAttribute("x")),
      y: Number(rect?.getAttribute("y")),
      width: Number(rect?.getAttribute("width")),
      height: Number(rect?.getAttribute("height")),
    };
  };
  return { svg, box };
};

describe("system view: boxes in boxes", () => {
  test("one frame holds the inbox and the cooks, and is not announced", () => {
    const { svg, box } = draw(false);
    const frames = [...svg.querySelectorAll("rect.part-frame")];
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute("aria-hidden")).toBe("true");
    const frame = {
      x: Number(frames[0]?.getAttribute("x")),
      y: Number(frames[0]?.getAttribute("y")),
      width: Number(frames[0]?.getAttribute("width")),
      height: Number(frames[0]?.getAttribute("height")),
    };
    for (const part of [box('g.part[data-part=""]'), box('g.part[data-part="cooks"]')]) {
      expect(part.x).toBeGreaterThan(frame.x);
      expect(part.y).toBeGreaterThan(frame.y);
      expect(part.x + part.width).toBeLessThan(frame.x + frame.width);
      expect(part.y + part.height).toBeLessThan(frame.y + frame.height);
    }
  });

  test("the frame's top and height keep their padding around the holder's box", () => {
    const { svg } = draw(false);
    const frame = svg.querySelector("rect.part-frame");
    expect(Number(frame?.getAttribute("y"))).toBe(20);
    expect(Number(frame?.getAttribute("height"))).toBe(125);
  });

  test("a part with no arrow to another part sits in a row under the board, with no entry or end", () => {
    const { svg, box } = draw(false);
    const net = box('g.part[data-part="net"]');
    const inbox = box('g.part[data-part=""]');
    expect(net.y).toBeGreaterThan(inbox.y + inbox.height);
    expect(svg.querySelector('[data-to="net"]')).toBeNull();
    expect(svg.querySelector('[data-from="net"]')).toBeNull();
    expect(svg.querySelector('[data-entry-event="DROP"]')).toBeNull();
    const height = Number(svg.getAttribute("height"));
    expect(net.y + net.height).toBeLessThan(height);
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${svg.getAttribute("width")} ${height}`);
  });

  test("wide runs left to right, narrow runs top to bottom", () => {
    const wide = draw(false);
    const pillWide = wide.box("g.link-start");
    expect(pillWide.x).toBeLessThan(wide.box('g.part[data-part=""]').x);
    const narrow = draw(true);
    expect(narrow.box("g.link-start").y).toBeLessThan(narrow.box('g.part[data-part=""]').y);
  });

  test("a board of parts drawn one by one keeps their order in the row", () => {
    const more: VizMachine = {
      ...board,
      regions: ["cooks", "net", "audio"],
      states: [...board.states, state("audio.on", true)],
    };
    const svg = renderSystem(document, more, systemOf(more), { select: () => {} });
    const ids = [...svg.querySelectorAll("g.part")].map((part) => part.getAttribute("data-part"));
    expect(ids.slice(-2)).toEqual(["net", "audio"]);
    const xs = ["net", "audio"].map((id) =>
      Number(svg.querySelector(`g.part[data-part="${id}"] rect`)?.getAttribute("x")),
    );
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
  });
});
