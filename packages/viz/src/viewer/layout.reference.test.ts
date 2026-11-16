import type { VizMachine } from "../schema.ts";
import { PORT_GAP, layoutMachine, placeMachine } from "./layout.ts";
import { overlapLines, overlapsOf } from "./overlaps.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

function reference(name: string): VizMachine {
  const file = new URL(`./reference/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as VizMachine;
}

test("teamInbox (the pool) has no overlaps", () => {
  expect(layoutMachine(reference("team-inbox"))[0]).toBeUndefined();
  expect(overlapLines(overlapsOf(placeMachine(reference("team-inbox"))))).toEqual([]);
});

test("checkout has no overlaps", () => {
  expect(layoutMachine(reference("checkout"))[0]).toBeUndefined();
  expect(overlapLines(overlapsOf(placeMachine(reference("checkout"))))).toEqual([]);
});

test("the docs home checkout has no overlaps", () => {
  expect(layoutMachine(reference("docs-checkout"))[0]).toBeUndefined();
  expect(overlapLines(overlapsOf(placeMachine(reference("docs-checkout"))))).toEqual([]);
});

function endsOnSide(name: string, id: string, side: "left" | "right"): number[] {
  const layout = placeMachine(reference(name));
  const node = layout.nodes.find((each) => each.id === id);
  if (node === undefined) return [];
  const edge = side === "left" ? node.x - node.width / 2 : node.x + node.width / 2;
  const ys: number[] = [];
  for (const placed of layout.edges) {
    for (const point of [placed.points.at(0), placed.points.at(-1)]) {
      if (point !== undefined && Math.abs(point.x - edge) < 1) ys.push(point.y);
    }
  }
  return ys.sort((a, b) => a - b);
}

test.each([
  ["team-inbox", "workWaiting"],
  ["team-inbox", "workersBusy"],
  ["checkout", "submitting"],
  ["checkout", "error"],
] as const)("%s %s: arrow ends on one side are PORT_GAP apart", (name, id) => {
  for (const side of ["left", "right"] as const) {
    const ys = endsOnSide(name, id, side);
    for (let index = 1; index < ys.length; index++) {
      expect((ys[index] ?? 0) - (ys[index - 1] ?? 0)).toBeGreaterThanOrEqual(PORT_GAP);
    }
  }
});
test("the port check sees ends", () => {
  expect(
    endsOnSide("team-inbox", "workersBusy", "left").length +
      endsOnSide("team-inbox", "workersBusy", "right").length,
  ).toBeGreaterThan(1);
});
