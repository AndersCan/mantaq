import { test, describe } from "vite-plus/test";
import { fc, anyActorSnapshot, anyName, runProperty } from "@mantaq/pbt";
import type { Snapshot } from "@mantaq/core";
import { matches } from "../src/actors/matches.ts";

function leafPaths(snap: Snapshot): string[][] {
  const keys = Object.keys(snap.regions);
  if (keys.length === 0) return [snap.path];
  const out: string[][] = [];
  for (const key of keys) {
    for (const leaf of leafPaths(snap.regions[key])) out.push([...snap.path, key, ...leaf]);
  }
  return out;
}

function referenceMatches(snap: Snapshot, pattern: string): boolean {
  if (!pattern) return false;
  const parts = pattern.split(".");
  for (const leaf of leafPaths(snap)) {
    if (parts.length > leaf.length) continue;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== leaf[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

describe("matches property tests", () => {
  test("matches is a segment prefix of some leaf path for any snapshot and pattern", () => {
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
        const expected = referenceMatches(snap, pattern);
        const actual = matches({ snapshot: () => snap }, pattern);
        return actual === expected;
      },
    );
  });

  test("exact leaf path always matches its snapshot", () => {
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
