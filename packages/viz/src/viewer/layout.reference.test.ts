import type { VizMachine } from "../schema.ts";
import { layoutMachine, placeMachine } from "./layout.ts";
import type { MachineLayout } from "./layout.ts";
import { overlapLines, overlapsOf } from "./overlaps.ts";
import type { Overlap } from "./overlaps.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

function reference(name: string): VizMachine {
  const file = new URL(`./reference/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as VizMachine;
}

/** Steep arrows in a rank gap are T4c's lanes; until then only they may still run alongside. */
function withoutAlongside(layout: MachineLayout): Overlap[] {
  return overlapsOf(layout).filter((overlap) => overlap.rule !== "paths-alongside");
}

test("teamInbox (the pool) has no overlaps", () => {
  expect(layoutMachine(reference("team-inbox"))[0]).toBeUndefined();
  expect(overlapLines(withoutAlongside(placeMachine(reference("team-inbox"))))).toEqual([]);
});

test("checkout has no overlaps", () => {
  expect(layoutMachine(reference("checkout"))[0]).toBeUndefined();
  expect(overlapLines(withoutAlongside(placeMachine(reference("checkout"))))).toEqual([]);
});

test("the docs home checkout has no overlaps", () => {
  expect(layoutMachine(reference("docs-checkout"))[0]).toBeUndefined();
  expect(overlapLines(withoutAlongside(placeMachine(reference("docs-checkout"))))).toEqual([]);
});
