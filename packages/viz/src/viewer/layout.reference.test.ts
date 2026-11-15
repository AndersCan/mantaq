import type { VizMachine } from "../schema.ts";
import { layoutMachine } from "./layout.ts";
import { overlapLines, overlapsOf } from "./overlaps.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

function reference(name: string): VizMachine {
  const file = new URL(`./reference/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as VizMachine;
}

// `it.fails` while the layout still overlaps; each layout task flips its machines to `test`.
test.fails("teamInbox (the pool) has no overlaps", () => {
  expect(overlapLines(overlapsOf(layoutMachine(reference("team-inbox"))))).toEqual([]);
});

test.fails("checkout has no overlaps", () => {
  expect(overlapLines(overlapsOf(layoutMachine(reference("checkout"))))).toEqual([]);
});

test.fails("the docs home checkout has no overlaps", () => {
  expect(overlapLines(overlapsOf(layoutMachine(reference("docs-checkout"))))).toEqual([]);
});
