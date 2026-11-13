// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { systemOf } from "../system.ts";
import { renderSystem } from "./system.ts";
import { mountViewer } from "./viewer.ts";

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

/** Inbox (3) ⇄ cooks (2); `net` talks to no part but declares an output nobody takes. */
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
  partOutputs: { cooks: ["DONE"], net: ["NOBODY"] },
  context: null,
  edges: [
    edge("empty", "ARRIVED", "holding", ["ASSIGNED"]),
    edge("holding", "DONE", "empty"),
    edge("cooks.free", "ASSIGNED", "cooks.busy", ["DONE"]),
    edge("net.up", "DROP", "net.up", ["NOBODY"]),
  ],
  runs: [],
  fuzz: null,
};

describe("boxes in boxes: attacked", () => {
  test("a part drawn alone draws no grey end and no arrow, even when its output has no taker", () => {
    const system = systemOf(board);
    expect(system.parts.find((part) => part.id === "net")?.alone).toBe(true);
    const svg = renderSystem(document, board, system, { select: () => {} });
    expect(svg.querySelector('[data-from="net"]')).toBeNull();
    expect(svg.querySelectorAll("g.link-end")).toHaveLength(0);
  });

  test("a part with two partners sits within neither, even when one is bigger", () => {
    // The root (1 state) sends to `a` (3) and takes from `c` (2): two partners, so within null.
    const machine: VizMachine = {
      ...board,
      id: "two",
      initial: "r",
      regions: ["a", "c"],
      maps: [],
      states: [
        state("r", true),
        state("a.x", true),
        state("a.y"),
        state("a.z"),
        state("c.x", true),
        state("c.y"),
      ],
      outputs: ["toA"],
      partOutputs: { c: ["toRoot"] },
      edges: [
        edge("r", "GO", "r", ["toA"]),
        edge("a.x", "toA", "a.y"),
        edge("c.x", "PING", "c.y", ["toRoot"]),
        edge("r", "toRoot", "r"),
      ],
    };
    const system = systemOf(machine);
    const root = system.parts.find((part) => part.id === "");
    expect(system.links.filter((link) => link.to !== null).map((link) => link.event)).toEqual(
      expect.arrayContaining(["toA", "toRoot"]),
    );
    expect(root?.within).toBeNull();
  });
});

describe("boxes in boxes: the viewer picks the direction from the host width", () => {
  const mounted = (clientWidth: number) => {
    const root = document.createElement("div");
    Object.defineProperty(root, "clientWidth", { value: clientWidth });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [board] });
    const y = (selector: string) =>
      Number(root.querySelector(`${selector} rect`)?.getAttribute("y"));
    const x = (selector: string) =>
      Number(root.querySelector(`${selector} rect`)?.getAttribute("x"));
    return { root, y, x };
  };

  test("a 390 px host runs top to bottom: the pill is above the inbox", () => {
    const { y } = mounted(390);
    expect(y("g.link-start")).toBeLessThan(y('g.part[data-part=""]'));
  });

  test("an unknown width (0) and 1280 px run left to right: the pill is left of the inbox", () => {
    for (const width of [0, 1280]) {
      const { x, y } = mounted(width);
      expect(x("g.link-start")).toBeLessThan(x('g.part[data-part=""]'));
      expect(y("g.link-start")).toBeGreaterThan(y('g.part[data-part=""]') - 48);
    }
  });

  test("559 px is narrow, 560 px is not", () => {
    const narrow = mounted(559);
    expect(narrow.y("g.link-start")).toBeLessThan(narrow.y('g.part[data-part=""]'));
    const wide = mounted(560);
    expect(wide.x("g.link-start")).toBeLessThan(wide.x('g.part[data-part=""]'));
    expect(wide.y("g.link-start")).toBeGreaterThan(wide.y('g.part[data-part=""]') - 48);
  });
});

describe("boxes in boxes: the row of parts drawn alone", () => {
  /** The `board` pair (inbox and cooks) plus one part per name, each with no partner. */
  const aloneMachine = (names: string[]): VizMachine => ({
    ...board,
    id: "row",
    regions: ["cooks", ...names],
    partOutputs: { cooks: ["DONE"] },
    states: [
      ...board.states.filter((each) => each.id !== "net.up"),
      ...names.map((name) => state(`${name}.up`, true)),
    ],
    edges: board.edges.filter((each) => each.from !== "net.up"),
  });
  const rendered = (names: string[]) => {
    const machine = aloneMachine(names);
    const svg = renderSystem(document, machine, systemOf(machine), { select: () => {} });
    const at = (name: string) => {
      const rect = svg.querySelector(`g.part[data-part="${name}"] rect`);
      return { x: Number(rect?.getAttribute("x")), y: Number(rect?.getAttribute("y")) };
    };
    const viewBox = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
    return { at, width: viewBox[2] ?? 0, height: viewBox[3] ?? 0 };
  };

  test("a few short parts share one row, in part order", () => {
    const { at } = rendered(["aa", "bb", "cc"]);
    expect(at("aa").y).toBe(at("bb").y);
    expect(at("bb").y).toBe(at("cc").y);
    expect(at("aa").x).toBeLessThan(at("bb").x);
    expect(at("bb").x).toBeLessThan(at("cc").x);
  });

  test("a long row wraps under itself, and the board is no wider than the box limit allows", () => {
    const names = Array.from({ length: 12 }, (_, index) => `part${index}`);
    const { at, width } = rendered(names);
    const ys = new Set(names.map((name) => at(name).y));
    expect(ys.size).toBeGreaterThan(1);
    expect(at("part0").x).toBe(at(names.find((name) => at(name).y === [...ys][1])!).x);
    for (const name of names) expect(at(name).x).toBeLessThan(width);
  });

  test("a row wider than the board widens the drawing to hold it", () => {
    const { at, width } = rendered(["aa", "bb", "cc"]);
    const last = at("cc");
    expect(width).toBeGreaterThan(last.x + 96);
  });

  test("a box wider than the board widens the drawing past the box and its margins", () => {
    const wide = "w".repeat(200);
    const { at, width } = rendered([wide]);
    expect(width).toBeGreaterThan(at(wide).x + 200 * 7);
  });

  test("the drawing is tall enough for the last row", () => {
    const names = Array.from({ length: 12 }, (_, index) => `part${index}`);
    const { at, height } = rendered(names);
    const bottom = Math.max(...names.map((name) => at(name).y));
    expect(height).toBeGreaterThan(bottom + 48);
  });
});
