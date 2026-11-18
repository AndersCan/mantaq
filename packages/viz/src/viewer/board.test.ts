import type { VizFuzzMessage, VizMachine } from "../schema.ts";
import { placeBoard } from "./board.ts";
import type { BoardLayout, PlacedPart } from "./board.ts";
import { partsOf } from "./parts.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

function reference(name: string): VizMachine {
  const file = new URL(`./reference/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as VizMachine;
}

const whole = reference("justus-whole-app");
const PART_GAP = 12;

function gap(a: PlacedPart, b: PlacedPart): number {
  const across = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  const down = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
  return Math.max(across, down);
}

function inside(box: PlacedPart, x: number, y: number, slack: number): boolean {
  return (
    Math.abs(x - box.x) < box.width / 2 + slack && Math.abs(y - box.y) < box.height / 2 + slack
  );
}

test("the whole app is 18 boxes inside the board, none closer than the gap", () => {
  const board = placeBoard(whole, 702);
  expect(board.parts).toHaveLength(18);
  expect(board.parts.map((box) => box.part)).toEqual(partsOf(whole));
  for (const box of board.parts) {
    expect(box.x - box.width / 2).toBeGreaterThanOrEqual(0);
    expect(box.y - box.height / 2).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width / 2).toBeLessThanOrEqual(board.width);
    expect(box.y + box.height / 2).toBeLessThanOrEqual(board.height);
  }
  for (const [index, box] of board.parts.entries()) {
    for (const other of board.parts.slice(index + 1)) {
      expect(gap(box, other), `${box.name} ${other.name}`).toBeGreaterThanOrEqual(PART_GAP);
    }
  }
});

test("the whole app's wires do not pass through other boxes", () => {
  const board = placeBoard(whole, 702);
  expect(board.wires.length).toBeGreaterThan(0);
  for (const wire of board.wires) {
    for (let index = 1; index < wire.points.length; index++) {
      const from = wire.points[index - 1];
      const to = wire.points[index];
      if (from === undefined || to === undefined) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
      for (let step = 0; step <= steps; step++) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const y = from.y + ((to.y - from.y) * step) / steps;
        for (const box of board.parts) {
          if (box.part === wire.from || box.part === wire.to) continue;
          expect(inside(box, x, y, 2), `${wire.from}>${wire.to} at ${box.name}`).toBe(false);
        }
      }
    }
    expect(wire.path.startsWith("M")).toBe(true);
    expect(wire.dotGap).toBeGreaterThan(0);
  }
});

test("boxes that wires do not reach fill rows no wider than the board", () => {
  const narrow = placeBoard(whole, 300);
  const wide = placeBoard(whole, 1400);
  const rows = (board: BoardLayout): number => new Set(board.parts.map((box) => box.y)).size;
  expect(rows(narrow)).toBeGreaterThan(rows(wide));
  const wired = new Set(wide.wires.flatMap((wire) => [wire.from, wire.to]));
  const loose = wide.parts.filter((box) => !wired.has(box.part));
  expect(loose.length).toBeGreaterThan(0);
  const block = Math.max(
    ...wide.parts.filter((box) => wired.has(box.part)).map((box) => box.y + box.height / 2),
  );
  for (const box of loose) expect(box.y - box.height / 2).toBeGreaterThanOrEqual(block);
});

function messageBetween(from: string, to: string): VizFuzzMessage {
  return { from, event: `to_${to.replace(".", "_")}`, to };
}

test("without wires the boxes are rows only", () => {
  const board = placeBoard({ ...whole, fuzz: null }, 702);
  expect(board.wires).toEqual([]);
  expect(board.parts).toHaveLength(18);
  expect(board.parts[0]?.x).toBeLessThan(board.parts[1]?.x ?? 0);
  expect(board.parts[0]?.y).toBe(board.parts[1]?.y);
});

test("a pair that messages both ways is one wire", () => {
  const fuzz = whole.fuzz;
  if (fuzz === null) throw new Error("reference is fuzzed");
  const board = placeBoard(
    {
      ...whole,
      fuzz: {
        ...fuzz,
        messages: [messageBetween("join.a", "sync.b"), messageBetween("sync.b", "join.a")],
      },
    },
    702,
  );
  expect(board.wires).toHaveLength(1);
  expect(board.wires[0]).toMatchObject({ from: "join", to: "sync", both: true });
});

test("a one-way pair and a message inside one part", () => {
  const fuzz = whole.fuzz;
  if (fuzz === null) throw new Error("reference is fuzzed");
  const board = placeBoard(
    {
      ...whole,
      fuzz: {
        ...fuzz,
        messages: [messageBetween("join.a", "sync.b"), messageBetween("join.a", "join.c")],
      },
    },
    702,
  );
  expect(board.wires).toHaveLength(1);
  expect(board.wires[0]).toMatchObject({ from: "join", to: "sync", both: false });
});

test("a width narrower than the wired block still fills rows to the block's width", () => {
  const board = placeBoard(whole, 50);
  const wired = new Set(board.wires.flatMap((wire) => [wire.from, wire.to]));
  const loose = board.parts.filter((box) => !wired.has(box.part));
  const rows = new Set(loose.map((box) => box.y)).size;
  expect(rows).toBeLessThan(loose.length);
  for (const box of board.parts) expect(box.x + box.width / 2).toBeLessThanOrEqual(board.width);
});

test("the whole app fits the width asked for, with its five wires drawn as they run", () => {
  const board = placeBoard(whole, 702);
  expect(board.width).toBeLessThanOrEqual(702);
  expect(board.wires.map((wire) => `${wire.from}${wire.both ? "<>" : ">"}${wire.to}`)).toEqual([
    "folders<>sync",
    "folders>join",
    "onboarding>folders",
    "people>requests",
    "sync>reach",
  ]);
});

test("a box wider than the board still takes the first row", () => {
  const board = placeBoard({ ...whole, fuzz: null }, 10);
  expect(board.parts[0]?.y).toBe(12 + 28 / 2);
  expect(new Set(board.parts.map((box) => box.y)).size).toBe(board.parts.length);
});
