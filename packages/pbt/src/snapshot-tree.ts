import { anyName } from "./generators.ts";
import fc from "fast-check";

export interface SnapshotTree {
  path: string[];
  context: unknown;
  regions: Record<string, SnapshotTree>;
  done?: boolean;
}

function snapshotTree(depth: number, maxPathLength: number): fc.Arbitrary<SnapshotTree> {
  const path = fc.array(anyName, { minLength: 1, maxLength: maxPathLength });
  const leaf = fc.record({
    path,
    context: fc.constant({}),
    regions: fc.constant({}),
  });

  function node(treeDepth: number): fc.Arbitrary<SnapshotTree> {
    if (treeDepth <= 0) return leaf;
    return fc.record({
      path,
      context: fc.constant({}),
      regions: fc.dictionary(anyName, node(treeDepth - 1), { maxKeys: 3 }),
    });
  }

  return node(depth);
}

export function anySnapshotTree(depth: number): fc.Arbitrary<SnapshotTree> {
  return snapshotTree(depth, 2);
}

export const anySnapshot: fc.Arbitrary<SnapshotTree> = anySnapshotTree(2);

export function anyActorSnapshotTree(depth: number): fc.Arbitrary<SnapshotTree> {
  return snapshotTree(depth, 1);
}

export const anyActorSnapshot: fc.Arbitrary<SnapshotTree> = anyActorSnapshotTree(2);
