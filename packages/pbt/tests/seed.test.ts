import { expect, test, describe } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import { parseSeed, DEFAULT_SEED, SEED_ENV } from "../src/index.ts";

describe("parseSeed", () => {
  test("unset falls back to DEFAULT_SEED", () => {
    const result = parseSeed(undefined);
    expect(Either.isRight(result)).toBe(true);
    expect(Either.getRight(result)).toBe(DEFAULT_SEED);
  });

  test("empty string is treated as unset, not 0", () => {
    const result = parseSeed("");
    expect(Either.isRight(result)).toBe(true);
    expect(Either.getRight(result)).toBe(DEFAULT_SEED);
  });

  test("valid integer is accepted", () => {
    const result = parseSeed("42");
    expect(Either.isRight(result)).toBe(true);
    expect(Either.getRight(result)).toBe(42);
  });

  test("negative integer is accepted", () => {
    const result = parseSeed("-7");
    expect(Either.getRight(result)).toBe(-7);
  });

  test("non-numeric value is rejected as Left", () => {
    const result = parseSeed("not-a-number");
    expect(Either.isLeft(result)).toBe(true);
    const err = Either.getLeft(result);
    expect(err?.kind).toBe("invalid-seed");
    expect(err?.raw).toBe("not-a-number");
  });

  test("non-integer numeric value is rejected as Left", () => {
    const result = parseSeed("3.14");
    expect(Either.isLeft(result)).toBe(true);
    expect(Either.getLeft(result)?.message).toContain("MANTAQ_SEED must be an integer");
  });

  test("empty env string is treated as unset", () => {
    const prev = process.env[SEED_ENV];
    process.env[SEED_ENV] = "";
    try {
      const result = parseSeed(process.env[SEED_ENV]);
      expect(Either.getRight(result)).toBe(DEFAULT_SEED);
    } finally {
      if (prev === undefined) delete process.env[SEED_ENV];
      else process.env[SEED_ENV] = prev;
    }
  });
});
