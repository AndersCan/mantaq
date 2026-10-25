import fc from "fast-check";

export function runProperty<T>(
  arb: fc.Arbitrary<T>,
  ...rest: [predicate: (value: T) => boolean | void, options?: fc.Parameters<[T]>]
): void {
  const [predicate, options] = rest;
  fc.assert(fc.property(arb, predicate), options);
}
