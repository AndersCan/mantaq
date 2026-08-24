import fc from "fast-check";
import { Either } from "@mantaq/utils";

export const SEED_ENV = "MANTAQ_SEED";
export const DEFAULT_SEED = 0x1a51e;

export interface SeedError {
  readonly kind: "invalid-seed";
  readonly raw: string;
  readonly message: string;
}

export function parseSeed(raw: string | undefined): Either<SeedError, number> {
  if (raw === undefined || raw === "") return Either.right(DEFAULT_SEED);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return Either.left<SeedError>({
      kind: "invalid-seed",
      raw,
      message: `MANTAQ_SEED must be an integer, got ${JSON.stringify(raw)}`,
    });
  }
  return Either.right(n);
}

const seedResult = parseSeed(process.env[SEED_ENV]);

export const seedError = Either.getLeft(seedResult);

const globalConfig = { numRuns: 100, endOnFailure: true, verbose: 1 } as const;

const validSeed = Either.getRight(seedResult);
fc.configureGlobal(validSeed === undefined ? globalConfig : { seed: validSeed, ...globalConfig });

export { fc };
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
  const node = (d: number): fc.Arbitrary<SnapshotTree> =>
    d <= 0
      ? leaf
      : fc.record({
          path: fc.array(anyName, { minLength: 1, maxLength: 2 }),
          context: fc.constant({}),
          regions: fc.dictionary(anyName, node(d - 1), { maxKeys: 3 }),
        });
  return node(depth);
}

export const anySnapshot: fc.Arbitrary<SnapshotTree> = anySnapshotTree(2);

export function anyActorSnapshotTree(depth: number): fc.Arbitrary<SnapshotTree> {
  const leaf = fc.record({
    path: fc.array(anyName, { minLength: 1, maxLength: 1 }),
    context: fc.constant({}),
    regions: fc.constant({}),
  });
  const node = (d: number): fc.Arbitrary<SnapshotTree> =>
    d <= 0
      ? leaf
      : fc.record({
          path: fc.array(anyName, { minLength: 1, maxLength: 1 }),
          context: fc.constant({}),
          regions: fc.dictionary(anyName, node(d - 1), { maxKeys: 3 }),
        });
  return node(depth);
}

export const anyActorSnapshot: fc.Arbitrary<SnapshotTree> = anyActorSnapshotTree(2);

export function runProperty<T>(
  arb: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  options?: fc.Parameters<[T]>,
): void {
  fc.assert(fc.property(arb, predicate), options);
}
