import fc from "fast-check";

export const SEED_ENV = "MANTAQ_SEED";
export const DEFAULT_SEED = 0x1a51e;

const seed = Number(process.env[SEED_ENV] ?? DEFAULT_SEED);

fc.configureGlobal({
  seed,
  numRuns: 100,
  endOnFailure: true,
  verbose: 1,
});

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
