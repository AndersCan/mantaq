import { isIn, activeLeaves } from "./snapshot.ts";
import type { Snapshot } from "@mantaq/core";
import { fc, anyActorSnapshot, anyName, runProperty } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

function leafPaths(snapshot: Snapshot): string[][] {
  const keys = Object.keys(snapshot.regions);
  if (keys.length === 0) return [snapshot.path];
  const out: string[][] = [];
  for (const key of keys) {
    for (const leaf of leafPaths(snapshot.regions[key])) out.push([...snapshot.path, key, ...leaf]);
  }
  return out;
}

function stateNames(snapshot: Snapshot): string[] {
  const names = [snapshot.path[0]];
  for (const region of Object.values(snapshot.regions)) names.push(...stateNames(region));
  return names;
}

describe("snapshot helper property tests", () => {
  test("matches any active state name in the tree and rejects unknown names", () => {
    runProperty(fc.tuple(anyActorSnapshot, anyName), ([snap, randomName]) => {
      const names = stateNames(snap);
      for (const name of [...names, randomName]) {
        if (isIn(snap, name) !== names.includes(name)) return false;
      }
      return true;
    });
  });

  test("equals the sorted set of leaf paths joined with dots", () => {
    runProperty(anyActorSnapshot, (snapshot) => {
      const expected = leafPaths(snapshot)
        .map((path) => path.join("."))
        .sort();
      const actual = [...activeLeaves(snapshot)].sort();
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
  });
});
