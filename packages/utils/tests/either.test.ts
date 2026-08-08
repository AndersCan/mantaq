import { expect, test, describe } from "vite-plus/test";
import { Either } from "../src/index.ts";

function liftRight<R extends {}>(value: R): Either<string, R> {
  return Either.right(value);
}

function liftLeft<L extends {}>(value: L): Either<L, number> {
  return Either.left(value);
}

describe("Either runtime", () => {
  test("left/right build the expected tuple shape", () => {
    expect(Either.left("boom")).toEqual(["boom", undefined]);
    expect(Either.right(42)).toEqual([undefined, 42]);
  });

  test("isLeft / isRight detect the populated slot", () => {
    const l = Either.left("err");
    const r = Either.right(1);
    expect(Either.isLeft(l)).toBe(true);
    expect(Either.isRight(l)).toBe(false);
    expect(Either.isRight(r)).toBe(true);
    expect(Either.isLeft(r)).toBe(false);
  });

  test("from returns right on success and left on throw", () => {
    expect(Either.from(() => 5)).toEqual([undefined, 5]);
    const err = new Error("boom");
    const caught = Either.from(() => {
      throw err;
    });
    expect(Either.isLeft(caught)).toBe(true);
    expect(Either.getLeft(caught)).toBe(err);
  });

  test("getLeft / getRight expose the value or undefined", () => {
    expect(Either.getLeft(Either.left("e"))).toBe("e");
    expect(Either.getLeft(Either.right(1))).toBeUndefined();
    expect(Either.getRight(Either.right(1))).toBe(1);
    expect(Either.getRight(Either.left("e"))).toBeUndefined();
  });

  test("leftOrThrow / rightOrThrow unwrap or throw", () => {
    expect(Either.leftOrThrow(Either.left("e"))).toBe("e");
    expect(Either.rightOrThrow(Either.right(1))).toBe(1);
    expect(() => Either.leftOrThrow(Either.right(1))).toThrow();
    expect(() => Either.rightOrThrow(Either.left("e"))).toThrow();
  });

  test("match runs the matching branch", () => {
    expect(
      Either.match(
        Either.left("e"),
        (l: string) => `L:${l}`,
        (r: string) => `R:${r}`,
      ),
    ).toBe("L:e");
    expect(
      Either.match(
        Either.right(1),
        (l: number) => `L:${l}`,
        (r: number) => `R:${r}`,
      ),
    ).toBe("R:1");
  });

  test("map transforms the right value", () => {
    expect(Either.map(Either.right(2), (n) => n * 3)).toEqual([undefined, 6]);
    const left = Either.left("e");
    expect(Either.map(left, (n: number) => n * 3)).toBe(left);
  });

  test("mapLeft transforms the left value", () => {
    expect(Either.mapLeft(Either.left("e"), (l) => l.length)).toEqual([1, undefined]);
    const right = Either.right(1);
    expect(Either.mapLeft(right, (l: string) => l.length)).toBe(right);
  });

  test("chain short-circuits on left", () => {
    const left = Either.left("e");
    expect(Either.chain(left, (n: number) => Either.right(n + 1))).toBe(left);
    expect(Either.chain(Either.right(1), (n) => Either.right(n + 1))).toEqual([undefined, 2]);
    expect(Either.chain(liftRight(1), () => Either.left("fail"))).toEqual(["fail", undefined]);
  });

  test("getOrElse falls back from left", () => {
    expect(Either.getOrElse(Either.right(7), () => 0)).toBe(7);
    expect(Either.getOrElse(liftLeft("e"), (l) => l.length)).toBe(1);
  });

  test("swap flips sides", () => {
    expect(Either.swap(Either.left("e"))).toEqual([undefined, "e"]);
    expect(Either.swap(Either.right(1))).toEqual([1, undefined]);
  });

  test("tap runs only on right and returns the same reference", () => {
    const right = Either.right(1);
    let seen: number | undefined;
    expect(Either.tap(right, (n) => (seen = n))).toBe(right);
    expect(seen).toBe(1);
    const left = Either.left("e");
    expect(Either.tap(left, () => (seen = 99))).toBe(left);
    expect(seen).toBe(1);
  });

  test("map on left is allocation-free", () => {
    const left = Either.left("e");
    const mapped = Either.map(left, (n: number) => n + 1);
    expect(mapped).toBe(left);
    expect(Either.isLeft(mapped)).toBe(true);
  });
});
