import { test, describe } from "vite-plus/test";
import { fc, anyActorSnapshot, anyName, runProperty } from "@mantaq/pbt";
import { state } from "@mantaq/core";
import { tag } from "../src/tags.ts";
import type { Snapshot } from "@mantaq/core";

function stateNames(snap: Snapshot): string[] {
  const names = [snap.path[0]];
  for (const region of Object.values(snap.regions)) names.push(...stateNames(region));
  return names;
}

describe("tag property tests", () => {
  test("tag.has is true iff any tagged state name is active in the tree", () => {
    runProperty(
      fc.tuple(anyActorSnapshot, fc.array(anyName, { minLength: 0, maxLength: 4 })),
      ([snap, randomNames]) => {
        const treeNames = stateNames(snap);
        const tagged = [...randomNames, ...treeNames];
        const t = tag(...tagged.map((n) => state(n)()));
        const expected = tagged.some((n) => treeNames.includes(n));
        return t.has(snap) === expected;
      },
    );
  });
});
