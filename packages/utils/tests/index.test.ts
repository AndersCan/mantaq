import { expect, test, describe } from "vite-plus/test";
import { deepMerge, assertNever, noop, pick, omit } from "../src/index.ts";

describe("deepMerge", () => {
  test("overrides keys from source", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  test("ignores undefined values", () => {
    const result = deepMerge({ a: 1 }, { a: undefined });
    expect(result).toEqual({ a: 1 });
  });

  test("adds new keys", () => {
    const result = deepMerge({ a: 1 } as Record<string, unknown>, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test("returns copy, not mutation", () => {
    const target = { a: 1 };
    const result = deepMerge(target, { b: 2 });
    expect(target).toEqual({ a: 1 });
    expect(result).not.toBe(target);
  });
});

describe("assertNever", () => {
  test("throws on call", () => {
    expect(() => assertNever("anything" as never)).toThrow("Unexpected value: anything");
  });
});

describe("noop", () => {
  test("returns undefined", () => {
    expect(noop()).toBeUndefined();
  });
});

describe("pick", () => {
  test("picks specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  test("returns empty object for empty keys", () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, [])).toEqual({});
  });

  test("ignores keys not in object", () => {
    const obj = { a: 1 };
    expect(pick(obj, ["a", "b" as keyof typeof obj])).toEqual({ a: 1 });
  });
});

describe("omit", () => {
  test("omits specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["a", "c"])).toEqual({ b: 2 });
  });

  test("returns full copy for empty keys", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, [])).toEqual({ a: 1, b: 2 });
  });

  test("not mutation", () => {
    const obj = { a: 1, b: 2 };
    const result = omit(obj, ["a"]);
    expect(obj).toEqual({ a: 1, b: 2 });
    expect(result).not.toBe(obj);
  });
});
