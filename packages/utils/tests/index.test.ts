import { expect, test, describe } from "vite-plus/test";
import { noop, isAborted, assertNever, createDeferred } from "../src/index.ts";

describe("noop", () => {
  test("returns undefined", () => {
    expect(noop()).toBeUndefined();
  });

  test("callable without error", () => {
    expect(() => noop()).not.toThrow();
  });
});

describe("isAborted", () => {
  test("returns true for aborted signal", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAborted(ctrl.signal)).toBe(true);
  });

  test("returns false for non-aborted signal", () => {
    const ctrl = new AbortController();
    expect(isAborted(ctrl.signal)).toBe(false);
  });
});

describe("assertNever", () => {
  test("throws with stringified value", () => {
    expect(() => assertNever("x" as never)).toThrow("Unexpected value: x");
  });

  test("throws with number", () => {
    expect(() => assertNever(42 as never)).toThrow("Unexpected value: 42");
  });
});

describe("createDeferred", () => {
  test("resolve resolves promise", async () => {
    const d = createDeferred<number>();
    d.resolve(42);
    await expect(d.promise).resolves.toBe(42);
  });

  test("reject rejects promise", async () => {
    const d = createDeferred();
    d.reject(new Error("boom"));
    await expect(d.promise).rejects.toThrow("boom");
  });

  test("resolve after creation works", () => {
    const d = createDeferred<string>();
    d.resolve("hello");
  });
});
