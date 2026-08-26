import { matches } from "./matches.ts";
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

function referenceMatches(options: { snapshot: Snapshot; pattern: string }): boolean {
  const { snapshot, pattern } = options;
  if (!pattern) return false;
  const parts = pattern.split(".");
  for (const leaf of leafPaths(snapshot)) {
    if (parts.length > leaf.length) continue;
    let matched = true;
    for (let index = 0; index < parts.length; index++) {
      if (parts[index] !== leaf[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

describe("matches property tests", () => {
  test("returns true exactly when the pattern prefixes some leaf path segment-wise", () => {
    runProperty(
      fc.record({
        snap: anyActorSnapshot,
        kind: fc.constantFrom("valid", "random"),
        leafIndex: fc.nat({ max: 20 }),
        prefixLen: fc.nat({ max: 10 }),
        random: fc.stringMatching(/^[a-z0-9.]{0,24}$/),
      }),
      ({ snap, kind, leafIndex, prefixLen, random }) => {
        const leaves = leafPaths(snap);
        let pattern: string;
        if (kind === "valid" && leaves.length > 0) {
          const leaf = leaves[leafIndex % leaves.length];
          pattern = leaf.slice(0, Math.min(prefixLen, leaf.length)).join(".");
        } else {
          pattern = random;
        }
        const expected = referenceMatches({ snapshot: snap, pattern });
        const actual = matches({ snapshot: () => snap }, pattern);
        return actual === expected;
      },
    );
  });

  test("returns true for an exact leaf path and false once extended", () => {
    runProperty(fc.tuple(anyActorSnapshot, anyName), ([snap, extra]) => {
      const leaves = leafPaths(snap);
      if (leaves.length === 0) return true;
      const leaf = leaves[0];
      if (!matches({ snapshot: () => snap }, leaf.join("."))) return false;
      if (matches({ snapshot: () => snap }, `${leaf.join(".")}.${extra}`)) return false;
      return true;
    });
  });
});
