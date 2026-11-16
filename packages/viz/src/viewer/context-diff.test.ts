import { expect, test } from "vite-plus/test";
import { changedKeys } from "./context-diff.ts";

test("changedKeys lists top-level keys whose JSON differs", () => {
  expect(changedKeys({ a: 1, b: { c: 1 }, d: 2 }, { a: 1, b: { c: 2 }, d: 2, e: 3 })).toEqual([
    "b",
    "e",
  ]);
  expect(changedKeys({ a: 1, gone: 1 }, { a: 1 })).toEqual(["gone"]);
  expect(changedKeys({ a: 1 }, { a: 1 })).toEqual([]);
  expect(changedKeys(undefined, { a: 1 })).toEqual(["a"]);
  expect(changedKeys(1, 2)).toEqual([]);
});
