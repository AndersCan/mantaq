import { DEFAULT_SEED, parseSeed } from "./index.ts";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

describe("parseSeed", () => {
  test("returns DEFAULT_SEED when unset", () => {
    const result = parseSeed(undefined);
    expect(Either.getRight(result)).toBe(DEFAULT_SEED);
  });

  test("returns DEFAULT_SEED for an empty string instead of 0", () => {
    const result = parseSeed("");
    expect(Either.getRight(result)).toBe(DEFAULT_SEED);
  });

  test("returns the parsed integer for a valid seed", () => {
    const result = parseSeed("42");
    expect(Either.getRight(result)).toBe(42);
  });

  test("returns the negative integer for a negative seed", () => {
    const result = parseSeed("-7");
    expect(Either.getRight(result)).toBe(-7);
  });

  test("rejects a non-numeric value as a left carrying the raw input", () => {
    const result = parseSeed("not-a-number");
    expect(Either.getLeft(result)).toEqual({
      kind: "invalid-seed",
      raw: "not-a-number",
      message: 'MANTAQ_SEED must be an integer, got "not-a-number"',
    });
  });

  test("rejects a non-integer numeric value as a left with the integer message", () => {
    const result = parseSeed("3.14");
    expect(Either.getLeft(result)).toEqual({
      kind: "invalid-seed",
      raw: "3.14",
      message: 'MANTAQ_SEED must be an integer, got "3.14"',
    });
  });
});
