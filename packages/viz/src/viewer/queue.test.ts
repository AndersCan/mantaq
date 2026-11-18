import type { VizMachine } from "../schema.ts";
import { hasQueue, queueOf } from "./queue.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const file = new URL("./reference/team-inbox.json", import.meta.url);
const pool = JSON.parse(readFileSync(file, "utf8")) as VizMachine;

test("a pool's inbox has a queue; other machines do not", () => {
  expect(hasQueue(pool)).toBe(true);
  expect(hasQueue({ ...pool, context: null })).toBe(false);
  expect(hasQueue({ ...pool, context: pool.context?.slice(1) ?? null })).toBe(false);
  expect(hasQueue({ ...pool, maps: [] })).toBe(false);
  const cast = { id: "x", states: [] } as unknown as VizMachine;
  expect(hasQueue(cast)).toBe(false);
});

test("queueOf lists the waiting items, first in line first", () => {
  expect(queueOf(pool, { waiting: ["b", "a"] })).toEqual({ count: 2, items: ["b", "a"] });
  expect(queueOf(pool, { waiting: [{ id: 1 }] }).items).toEqual(['{"id":1}']);
});

test("queueOf keeps the full count but only 50 texts", () => {
  const waiting = Array.from({ length: 60 }, (_, n) => `i${n}`);
  const queue = queueOf(pool, { waiting });
  expect(queue.count).toBe(60);
  expect(queue.items).toHaveLength(50);
});

test("queueOf is empty without a queue or an array", () => {
  const none = { count: 0, items: [] };
  expect(queueOf(pool, { waiting: "x" })).toEqual(none);
  expect(queueOf(pool, "x")).toEqual(none);
  expect(queueOf(pool, null)).toEqual(none);
  expect(queueOf(pool, [])).toEqual(none);
  expect(queueOf({ ...pool, context: null }, { waiting: ["a"] })).toEqual(none);
});
