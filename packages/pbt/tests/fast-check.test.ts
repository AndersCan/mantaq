import { expect, test, describe } from "vite-plus/test";
import { fc, anyName, anyDuration, anyActorSnapshot, runProperty } from "../src/index.ts";

describe("pbt infra", () => {
  test("anyName generates non-empty dot-free lowercase strings", () => {
    runProperty(fc.array(anyName, { minLength: 1, maxLength: 50 }), (names) =>
      names.every((n) => n.length > 0 && !n.includes(".") && n === n.toLowerCase()),
    );
  });

  test("anyDuration is a non-negative integer", () => {
    runProperty(fc.array(anyDuration, { minLength: 1, maxLength: 100 }), (ms) =>
      ms.every((m) => Number.isInteger(m) && m >= 0),
    );
  });

  test("anyActorSnapshot is a well-formed tree", () => {
    runProperty(anyActorSnapshot, (snap) => {
      if (!Array.isArray(snap.path) || snap.path.length === 0) return false;
      if (snap.regions === null || typeof snap.regions !== "object") return false;
      return true;
    });
  });

  test("runProperty invokes the predicate for every generated value", () => {
    let calls = 0;
    runProperty(
      fc.constant("x"),
      () => {
        calls++;
        return true;
      },
      { numRuns: 10 },
    );
    expect(calls).toBe(10);
  });
});
