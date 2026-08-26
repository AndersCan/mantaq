import { seedEnvironment } from "./env.ts";
import { DEFAULT_SEED, SEED_ENV, parseSeed } from "./parse-seed.ts";
import type { SeedError } from "./parse-seed.ts";
import { Either } from "@mantaq/utils";
import fc from "fast-check";

const seedResult = parseSeed(seedEnvironment);

export const seedError = Either.getLeft(seedResult);

const globalConfig = { numRuns: 100, endOnFailure: true, verbose: 1 };

const validSeed = Either.getRight(seedResult);
fc.configureGlobal(validSeed === undefined ? globalConfig : { seed: validSeed, ...globalConfig });

export { DEFAULT_SEED, SEED_ENV, parseSeed, fc };
export type { SeedError };
export type { Arbitrary } from "fast-check";

export const anyName = fc.stringMatching(/^[a-z0-9]{1,12}$/);

export const anyDuration = fc.integer({ min: 0, max: 10_000 });

export const anySmallDuration = fc.integer({ min: 0, max: 100 });

export const anyPayload = fc.jsonValue();

export interface SnapshotTree {
  path: string[];
  context: unknown;
  regions: Record<string, SnapshotTree>;
  done?: boolean;
}

export function anySnapshotTree(depth: number): fc.Arbitrary<SnapshotTree> {
  const leaf = fc.record({
    path: fc.array(anyName, { minLength: 1, maxLength: 2 }),
    context: fc.constant({}),
    regions: fc.constant({}),
  });

  function node(treeDepth: number): fc.Arbitrary<SnapshotTree> {
    if (treeDepth <= 0) return leaf;
    return fc.record({
      path: fc.array(anyName, { minLength: 1, maxLength: 2 }),
      context: fc.constant({}),
      regions: fc.dictionary(anyName, node(treeDepth - 1), { maxKeys: 3 }),
    });
  }

  return node(depth);
}

export const anySnapshot: fc.Arbitrary<SnapshotTree> = anySnapshotTree(2);

export function anyActorSnapshotTree(depth: number): fc.Arbitrary<SnapshotTree> {
  const leaf = fc.record({
    path: fc.array(anyName, { minLength: 1, maxLength: 1 }),
    context: fc.constant({}),
    regions: fc.constant({}),
  });

  function node(treeDepth: number): fc.Arbitrary<SnapshotTree> {
    if (treeDepth <= 0) return leaf;
    return fc.record({
      path: fc.array(anyName, { minLength: 1, maxLength: 1 }),
      context: fc.constant({}),
      regions: fc.dictionary(anyName, node(treeDepth - 1), { maxKeys: 3 }),
    });
  }

  return node(depth);
}

export const anyActorSnapshot: fc.Arbitrary<SnapshotTree> = anyActorSnapshotTree(2);

export function runProperty<T>(
  arb: fc.Arbitrary<T>,
  ...rest: [predicate: (value: T) => boolean | void, options?: fc.Parameters<[T]>]
): void {
  const [predicate, options] = rest;
  fc.assert(fc.property(arb, predicate), options);
}
