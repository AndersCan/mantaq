import { expect, test } from "vite-plus/test";
import type { VizLiveChild, VizLiveState, VizMachine, VizState } from "../schema.ts";
import { countsOf, nextKey, nounOf } from "./pool-count.ts";

const state = (id: string): VizState => ({
  id,
  label: id.slice(id.lastIndexOf(".") + 1),
  region: "workers",
  initial: false,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const machine = { states: [state("workers.free"), state("workers.working")] } as VizMachine;
const liveOf = (children: VizLiveChild[]) => ({ children }) as VizLiveState;
const child = (key: string, at: string): VizLiveChild => ({
  map: "workers",
  key,
  state: `workers.${at}`,
  since: 0,
});

test("two free children are one item", () => {
  const counts = countsOf(machine, liveOf([child("w1", "free"), child("w2", "free")]), "workers");
  expect(counts).toEqual({
    total: 2,
    items: [{ state: "workers.free", label: "free", keys: ["w1", "w2"] }],
  });
});

test("items follow the machine's state order, not the children's", () => {
  const counts = countsOf(
    machine,
    liveOf([child("w1", "working"), child("w2", "free")]),
    "workers",
  );
  expect(counts.items.map((item) => item.label)).toEqual(["free", "working"]);
});

test("no children is total 0 and no items", () => {
  expect(countsOf(machine, liveOf([]), "workers")).toEqual({ total: 0, items: [] });
});

test("another map's children are not counted", () => {
  const other = { ...child("x1", "free"), map: "other" };
  expect(countsOf(machine, liveOf([other]), "workers").total).toBe(0);
});

test("keys sort numerically", () => {
  const counts = countsOf(machine, liveOf([child("w10", "free"), child("w2", "free")]), "workers");
  expect(counts.items[0]?.keys).toEqual(["w2", "w10"]);
});

test("the noun loses its s for exactly one child", () => {
  expect(nounOf("workers", 1)).toBe("worker");
  expect(nounOf("workers", 2)).toBe("workers");
  expect(nounOf("workers", 0)).toBe("workers");
  expect(nounOf("team", 1)).toBe("team");
});

test("nextKey walks on, wraps, and starts at the first", () => {
  expect(nextKey(["w1", "w2"], "w1")).toBe("w2");
  expect(nextKey(["w1", "w2"], "w2")).toBe("w1");
  expect(nextKey(["w1", "w2"], undefined)).toBe("w1");
  expect(nextKey(["w1", "w2"], "w9")).toBe("w1");
});

test("walking as many times as there are keys visits each once and comes back", () => {
  const keys = ["w1", "w2", "w10"];
  const seen: string[] = [];
  let at: string | undefined = "w1";
  for (let n = 0; n < keys.length; n++) {
    at = nextKey(keys, at);
    seen.push(at);
  }
  expect(seen).toEqual(["w2", "w10", "w1"]);
});
