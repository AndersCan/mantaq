import { Either } from "./index.ts";
import type { Either as EitherType, Left, Right } from "./index.ts";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";

type AcceptsNullArgument<FunctionLike> = FunctionLike extends (value: infer Parameter) => unknown
  ? null extends Parameter
    ? true
    : false
  : false;

function liftRight<R extends {}>(value: R): Either<string, R> {
  return Either.right(value);
}

describe("Either type level contract", () => {
  test("builds the exact tuple types for the constructors", () => {
    expectTypeOf(Either.left("boom")).toEqualTypeOf<Left<string>>();
    expectTypeOf(Either.left(0)).toEqualTypeOf<Left<number>>();
    expectTypeOf(Either.right(42)).toEqualTypeOf<Right<number>>();
  });

  test("returns unknown left and inferred right through from", () => {
    expectTypeOf(Either.from(() => 5)).toEqualTypeOf<EitherType<unknown, number>>();
    expectTypeOf(Either.from(() => "x")).toEqualTypeOf<EitherType<unknown, string>>();
  });

  test("handles tuple narrowing with isLeft and isRight", () => {
    const result: EitherType<number, string> = Either.right("x");
    if (Either.isLeft(result)) {
      const left: number = result[0];
      const right: undefined = result[1];
      expect(left).toBeDefined();
      expect(right).toBeUndefined();
    } else {
      const right: string = result[1];
      const left: undefined = result[0];
      expect(right).toBeDefined();
      expect(left).toBeUndefined();
    }
    if (Either.isRight(result)) {
      const right: string = result[1];
      expect(right).toBeDefined();
    }
  });

  test("handles both branches in match", () => {
    const result: EitherType<Error, number> = Either.right(1);
    Either.match(result, {
      onLeft: (left) => {
        const failure: Error = left;
        expect(failure).toBeInstanceOf(Error);
        return 0;
      },
      onRight: (right) => {
        const success: number = right;
        expect(success).toBeDefined();
        return success;
      },
    });
  });

  test("keeps the left side type through map and chain", () => {
    const result: EitherType<Error, number> = Either.right(1);
    const mapped: EitherType<Error, string> = Either.map(result, {
      onRight: (value) => value.toFixed(),
    });
    const chained: EitherType<Error, number> = Either.chain(result, {
      onRight: (value) => Either.right(value + 1),
    });
    expect(Either.isRight(mapped)).toBe(true);
    expect(Either.isRight(chained)).toBe(true);
  });

  test("returns the right type from getOrElse", () => {
    const result = liftRight(1);
    const outcome: number = Either.getOrElse(result, { onLeft: (left) => left.length });
    expect(outcome).toBe(1);
  });

  test("returns swapped type parameters from swap", () => {
    const result: EitherType<string, number> = Either.right(1);
    const swapped: EitherType<number, string> = Either.swap(result);
    expect(Either.isLeft(swapped)).toBe(true);
  });

  test("rejects nullish side values at construction time", () => {
    expectTypeOf<AcceptsNullArgument<typeof Either.left>>().toEqualTypeOf<false>();
    expectTypeOf<AcceptsNullArgument<typeof Either.right>>().toEqualTypeOf<false>();
    expectTypeOf<AcceptsNullArgument<(value: string | null) => unknown>>().toEqualTypeOf<true>();
  });

  test("handles inspection of the left slot on a right Either", () => {
    const result = Either.right("x");
    if (!Either.isLeft(result)) {
      const left: undefined = result[0];
      const right: string = result[1];
      expect(left).toBeUndefined();
      expect(right).toBeDefined();
    }
    expect(Either.isLeft(result)).toBe(false);
  });
});
