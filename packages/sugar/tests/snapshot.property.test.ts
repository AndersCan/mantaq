import { test, describe } from "vite-plus/test";
import { fc, anyActorSnapshot, anyName, runProperty } from "@mantaq/pbt";
import type { Snapshot } from "@mantaq/core";
import { isIn, activeLeaves } from "../src/snapshot.ts";

function leafPaths(snap: Snapshot): string[][] {
  const keys = Object.keys(snap.regions);
  if (keys.length === 0) return [snap.path];
  const out: string[][] = [];
  for (const key of keys) {
    for (const leaf of leafPaths(snap.regions[key])) out.push([...snap.path, key, ...leaf]);
  }
  return out;
}

function stateNames(snap: Snapshot): string[] {
  const names = [snap.path[0]];
  for (const region of Object.values(snap.regions)) names.push(...stateNames(region));
  return names;
}

describe("snapshot helper property tests", () => {
  test("isIn matches any active state name in the tree", () => {
    runProperty(fc.tuple(anyActorSnapshot, anyName), ([snap, randomName]) => {
      const names = stateNames(snap);
      for (const name of [...names, randomName]) {
        if (isIn(snap, name) !== names.includes(name)) return false;
      }
      return true;
    });
  });

  test("activeLeaves equals the leaf paths joined with dots", () => {
    runProperty(anyActorSnapshot, (snap) => {
      const expected = leafPaths(snap)
        .map((p) => p.join("."))
        .sort();
      const actual = [...activeLeaves(snap)].sort();
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
  });
});
