import type { VizMachine } from "../schema.ts";
import { layoutMachine, placeMachine } from "./layout.ts";
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
