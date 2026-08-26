import { tag } from "./tags.ts";
import { state } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { fc, anyActorSnapshot, anyName, runProperty } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

function stateNames(snapshot: Snapshot): string[] {
  const names = [snapshot.path[0]];
  for (const region of Object.values(snapshot.regions)) names.push(...stateNames(region));
  return names;
}

describe("tag property tests", () => {
  test("sets has() to true iff any tagged state name is active in the tree", () => {
    runProperty(
      fc.tuple(anyActorSnapshot, fc.array(anyName, { minLength: 0, maxLength: 4 })),
      ([snap, randomNames]) => {
        const treeNames = stateNames(snap);
        const tagged = [...randomNames, ...treeNames];
        const created = tag(...tagged.map((name) => state(name)()));
        const expected = tagged.some((name) => treeNames.includes(name));
        return created.has(snap) === expected;
      },
    );
  });
});
