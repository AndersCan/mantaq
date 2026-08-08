import { expect, expectTypeOf, test, describe } from "vite-plus/test";
import { Either, type Either as EitherType, type Left, type Right } from "../src/index.ts";

function liftRight<R extends {}>(value: R): Either<string, R> {
  return Either.right(value);
}

describe("Either type level contract", () => {
  test("constructors build the exact tuple types", () => {
    expectTypeOf(Either.left("boom")).toEqualTypeOf<Left<string>>();
    expectTypeOf(Either.left(0)).toEqualTypeOf<Left<number>>();
    expectTypeOf(Either.right(42)).toEqualTypeOf<Right<number>>();
  });

  test("from carries unknown left and inferred right", () => {
    expectTypeOf(Either.from(() => 5)).toEqualTypeOf<EitherType<unknown, number>>();
    expectTypeOf(Either.from(() => "x")).toEqualTypeOf<EitherType<unknown, string>>();
  });

  test("isLeft / isRight narrow the tuple", () => {
    const e: EitherType<number, string> = Either.right("x");
    if (Either.isLeft(e)) {
      const left: number = e[0];
      const right: undefined = e[1];
      expect(left).toBeDefined();
      expect(right).toBeUndefined();
    } else {
      const right: string = e[1];
      const left: undefined = e[0];
      expect(right).toBeDefined();
      expect(left).toBeUndefined();
    }
    if (Either.isRight(e)) {
      const right: string = e[1];
      expect(right).toBeDefined();
    }
  });

  test("match narrows both branches", () => {
    const e: EitherType<Error, number> = Either.right(1);
    Either.match(
      e,
      (l) => {
        const left: Error = l;
        expect(left).toBeInstanceOf(Error);
        return 0;
      },
      (r) => {
        const right: number = r;
        expect(right).toBeDefined();
        return r;
      },
    );
  });

  test("map/chain keep the left side type", () => {
    const e: EitherType<Error, number> = Either.right(1);
    const mapped: EitherType<Error, string> = Either.map(e, (n) => n.toFixed());
    const chained: EitherType<Error, number> = Either.chain(e, (n) => Either.right(n + 1));
    expect(Either.isRight(mapped)).toBe(true);
    expect(Either.isRight(chained)).toBe(true);
  });

  test("getOrElse collapses to the right type", () => {
    const e = liftRight(1);
    const out: number = Either.getOrElse(e, (l) => l.length);
    expect(out).toBe(1);
  });

  test("swap flips the type parameters", () => {
    const e: EitherType<string, number> = Either.right(1);
    const swapped: EitherType<number, string> = Either.swap(e);
    expect(Either.isLeft(swapped)).toBe(true);
  });

  test("nullish sides are rejected at construction", () => {
    // @ts-expect-error null is a sentinel-adjacent value — must not be a side value
    Either.left(null);
    // @ts-expect-error undefined is the sentinel — cannot be a side value
    Either.right(undefined);
    // @ts-expect-error undefined is the sentinel — cannot be a side value
    Either.left(undefined);
  });

  test("left of Either.right cannot be inspected as a value", () => {
    const e = Either.right("x");
    if (!Either.isLeft(e)) {
      const left: undefined = e[0];
      const right: string = e[1];
      expect(left).toBeUndefined();
      expect(right).toBeDefined();
    }
    expect(Either.isLeft(e)).toBe(false);
  });
});
