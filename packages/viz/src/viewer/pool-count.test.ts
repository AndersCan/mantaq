import { expect, test } from "vite-plus/test";
import type { VizLiveChild, VizLiveState, VizMachine, VizState } from "../schema.ts";
import { childIn, countsOf, countTitle } from "./pool-count.ts";

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

test("the title counts by state in machine order, whatever the child order", () => {
  const live = liveOf([child("w1", "working"), child("w2", "free")]);
  expect(countTitle(machine, live, "workers")).toBe("workers: 1 free, 1 working");
});

test("the title of one state lists just it", () => {
  const live = liveOf([child("w1", "free"), child("w2", "free")]);
  expect(countTitle(machine, live, "workers")).toBe("workers: 2 free");
});

test("the title with no children is none", () => {
  expect(countTitle(machine, liveOf([]), "workers")).toBe("workers: none");
});

test("the title ignores another map's children", () => {
  const other = { ...child("x1", "free"), map: "other" };
  expect(countTitle(machine, liveOf([other]), "workers")).toBe("workers: none");
});

test("a click picks the lowest key in the state, w2 before w10", () => {
  const live = liveOf([child("w10", "free"), child("w2", "free"), child("w1", "working")]);
  expect(childIn(live, "workers", "workers.free")).toBe("w2");
});

test("a nested state's child is in its parent state", () => {
  const nested = { ...child("w1", "working"), state: "workers.working.lifting" };
  expect(childIn(liveOf([nested]), "workers", "workers.working")).toBe("w1");
});

test("a state no child is in picks none", () => {
  expect(childIn(liveOf([child("w1", "free")]), "workers", "workers.working")).toBeUndefined();
});

test("a state whose id only starts with the same letters does not match", () => {
  const near = { ...child("w1", "workingLate") };
  expect(childIn(liveOf([near]), "workers", "workers.working")).toBeUndefined();
});

test("another map's child is not picked", () => {
  const other = { ...child("x1", "free"), map: "other" };
  expect(childIn(liveOf([other]), "workers", "workers.free")).toBeUndefined();
});
