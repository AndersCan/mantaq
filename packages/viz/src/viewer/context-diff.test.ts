import { expect, test } from "vite-plus/test";
import type { VizJson } from "../schema.ts";
import { changedKeys, contextLines } from "./context-diff.ts";

const text = (value: VizJson, before: VizJson | undefined) =>
  contextLines(value, before)
    .map((line) => line.text)
    .join("\n");
const changed = (value: VizJson, before: VizJson | undefined) =>
  contextLines(value, before)
    .filter((line) => line.changed)
    .map((line) => line.text.trim());

const samples: VizJson[] = [
  null,
  3,
  "x",
  [],
  {},
  [1, [2, {}], { a: [] }],
  { a: 1, b: { c: [true, null, "s"], d: {} }, "k y": "q" },
];

test("text matches JSON.stringify", () => {
  for (const sample of samples)
    expect(text(sample, undefined)).toBe(JSON.stringify(sample, null, 2));
});

test("no previous context marks nothing", () => {
  for (const sample of samples) expect(changed(sample, undefined)).toEqual([]);
});

test("identical context marks nothing", () => {
  for (const sample of samples) expect(changed(sample, sample)).toEqual([]);
});

test("marks changed and added values only", () => {
  expect(changed({ a: 1, b: { c: 2, d: 3 }, e: 5 }, { a: 1, b: { c: 2, d: 4 } })).toEqual([
    '"d": 3',
    '"e": 5',
  ]);
});

test("marks array items that differ", () => {
  expect(changed({ items: [1, 2, 9] }, { items: [1, 2] })).toEqual(["9"]);
});

test("a type change is marked", () => {
  expect(changed({ a: { b: 1 } }, { a: 1 })).toEqual(['"b": 1']);
  expect(changed({ a: 1 }, { a: null })).toEqual(['"a": 1']);
});

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
