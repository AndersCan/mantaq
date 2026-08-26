import { Either } from "./index.ts";
import { describe, expect, test } from "vite-plus/test";

function liftRight<R extends {}>(value: R): Either<string, R> {
  return Either.right(value);
}

function liftLeft<L extends {}>(value: L): Either<L, number> {
  return Either.left(value);
}

function isErrorValue(value: unknown): value is Error {
  return value instanceof Error;
}

describe("Either runtime", () => {
  test("builds the expected tuple shape for left and right", () => {
    expect(Either.left("boom")).toEqual(["boom", undefined]);
    expect(Either.right(42)).toEqual([undefined, 42]);
  });

  test("returns true only from the predicate matching the populated slot", () => {
    const failure = Either.left("err");
    const success = Either.right(1);
    expect(Either.isLeft(failure)).toBe(true);
    expect(Either.isRight(failure)).toBe(false);
    expect(Either.isRight(success)).toBe(true);
    expect(Either.isLeft(success)).toBe(false);
  });

  test("returns right on success and left on throw inside from", () => {
    expect(Either.from(() => 5)).toEqual([undefined, 5]);
    const failure = new Error("boom");
    const caught = Either.from(() => JSON.parse("{invalid"));
    expect(Either.isLeft(caught)).toBe(true);
    expect(Either.getLeft(caught)).toBeInstanceOf(Error);
    expect(Either.getLeft(caught)).not.toBe(failure);
  });

  test("returns left capturing the exact thrown error", () => {
    const failure = new Error("boom");
    function isExplodingError(): never {
      throw failure;
    }
    const caught = Either.from(isExplodingError);
    expect(Either.getLeft(caught)).toBe(failure);
  });

  test("normalizes a thrown undefined into an error", () => {
    function isUndefinedExplosion(): never {
      throw undefined;
    }
    const caught = Either.from(isUndefinedExplosion);
    const leftValue = Either.getLeft(caught);
    expect(isErrorValue(leftValue) && leftValue.message).toMatch(/thrown value was undefined/);
  });

  test("rejects undefined as a Right (#208)", () => {
    const result = Either.from(() => undefined);
    expect(Either.isLeft(result)).toBe(true);
    expect(Either.isRight(result)).toBe(false);
    expect(
      Either.match(result, {
        onLeft: () => "L",
        onRight: () => "R",
      }),
    ).toBe("L");
    expect(Either.getRight(result)).toBeUndefined();
  });

  test("rejects null as a Right (#208)", () => {
    const result = Either.from(() => JSON.parse("null"));
    expect(Either.isLeft(result)).toBe(true);
    expect(Either.isRight(result)).toBe(false);
    expect(
      Either.match(result, {
        onLeft: () => "L",
        onRight: () => "R",
      }),
    ).toBe("L");
  });

  test("keeps valid falsy Right values", () => {
    expect(Either.from(() => 0)).toEqual([undefined, 0]);
    expect(Either.from(() => false)).toEqual([undefined, false]);
    expect(Either.from(() => "")).toEqual([undefined, ""]);
    expect(Either.isRight(Either.from(() => 0))).toBe(true);
  });

  test("returns the stored value or undefined from getLeft and getRight", () => {
    expect(Either.getLeft(Either.left("e"))).toBe("e");
    expect(Either.getLeft(Either.right(1))).toBeUndefined();
    expect(Either.getRight(Either.right(1))).toBe(1);
    expect(Either.getRight(Either.left("e"))).toBeUndefined();
  });

  test("returns the matched branch result from match", () => {
    expect(
      Either.match(Either.left("e"), {
        onLeft: (left: string) => `L:${left}`,
        onRight: (right: string) => `R:${right}`,
      }),
    ).toBe("L:e");
    expect(
      Either.match(Either.right(1), {
        onLeft: (left: number) => `L:${left}`,
        onRight: (right: number) => `R:${right}`,
      }),
    ).toBe("R:1");
  });

  test("returns a mapped Either with the right value transformed", () => {
    expect(Either.map(Either.right(2), { onRight: (value) => value * 3 })).toEqual([undefined, 6]);
    const failure = Either.left("e");
    expect(Either.map(failure, { onRight: (value: number) => value * 3 })).toBe(failure);
  });

  test("returns a remapped Either with the left value transformed", () => {
    expect(Either.mapLeft(Either.left("e"), { onLeft: (value) => value.length })).toEqual([
      1,
      undefined,
    ]);
    const success = Either.right(1);
    expect(Either.mapLeft(success, { onLeft: (value: string) => value.length })).toBe(success);
  });

  test("keeps the left reference when chaining over a left", () => {
    const failure = Either.left("e");
    expect(Either.chain(failure, { onRight: (value: number) => Either.right(value + 1) })).toBe(
      failure,
    );
    expect(Either.chain(Either.right(1), { onRight: (value) => Either.right(value + 1) })).toEqual([
      undefined,
      2,
    ]);
    expect(Either.chain(liftRight(1), { onRight: () => Either.left("fail") })).toEqual([
      "fail",
      undefined,
    ]);
  });

  test("returns the fallback value when getOrElse sees a left", () => {
    expect(Either.getOrElse(Either.right(7), { onLeft: () => 0 })).toBe(7);
    expect(Either.getOrElse(liftLeft("e"), { onLeft: (value) => value.length })).toBe(1);
  });

  test("returns swapped sides from swap", () => {
    expect(Either.swap(Either.left("e"))).toEqual([undefined, "e"]);
    expect(Either.swap(Either.right(1))).toEqual([1, undefined]);
  });

  test("calls the visitor only on right and returns the same reference", () => {
    const success = Either.right(1);
    let seen: number | undefined;
    expect(Either.tap(success, { onRight: (value) => (seen = value) })).toBe(success);
    expect(seen).toBe(1);
    const failure = Either.left("e");
    expect(Either.tap(failure, { onRight: () => (seen = 99) })).toBe(failure);
    expect(seen).toBe(1);
  });

  test("returns the same reference when mapping a left (allocation-free)", () => {
    const failure = Either.left("e");
    const mapped = Either.map(failure, { onRight: (value: number) => value + 1 });
    expect(mapped).toBe(failure);
    expect(Either.isLeft(mapped)).toBe(true);
  });
});
