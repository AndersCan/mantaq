import { anyActorSnapshot, anyDuration, anyName, fc, runProperty } from "./index.ts";
import { describe, expect, test } from "vite-plus/test";

describe("pbt infra", () => {
  test("returns only non-empty lowercase dot-free strings from anyName", () => {
    runProperty(fc.array(anyName, { minLength: 1, maxLength: 50 }), (names) =>
      names.every((name) => name.length > 0 && !name.includes(".") && name === name.toLowerCase()),
    );
  });

  test("returns only non-negative integers from anyDuration", () => {
    runProperty(fc.array(anyDuration, { minLength: 1, maxLength: 100 }), (durations) =>
      durations.every((duration) => Number.isInteger(duration) && duration >= 0),
    );
  });

  test("returns well-formed snapshot trees from anyActorSnapshot", () => {
    runProperty(anyActorSnapshot, (snapshot) => {
      if (!Array.isArray(snapshot.path) || snapshot.path.length === 0) return false;
      if (snapshot.regions === null || typeof snapshot.regions !== "object") return false;
      return true;
    });
  });

  test("calls the predicate once per generated value in runProperty", () => {
    let calls = 0;
    runProperty(
      fc.constant("x"),
      () => {
        calls += 1;
        return true;
      },
      { numRuns: 10 },
    );
    expect(calls).toBe(10);
  });
});
