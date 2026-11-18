import type { VizMachine } from "../schema.ts";
import { partMachine, partName, partOf, partsOf } from "./parts.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

function reference(name: string): VizMachine {
  const file = new URL(`./reference/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as VizMachine;
}

const whole = reference("justus-whole-app");

test("boards below three machines have no parts", () => {
  expect(partsOf(reference("checkout"))).toEqual([]);
  expect(partsOf(reference("team-inbox"))).toEqual([]);
  expect(partsOf({ ...whole, actors: ["join"] })).toEqual([]);
});

test("the whole app has its own part then one per actor", () => {
  expect(partsOf(whole)).toEqual(["", ...whole.actors]);
  expect(partsOf(whole)).toHaveLength(18);
});

test("an id belongs to the actor it is, or is under; else to the machine", () => {
  expect(partOf(whole, "join")).toBe("join");
  expect(partOf(whole, "join.waitingForAdminToAccept")).toBe("join");
  expect(partOf(whole, "joined.x")).toBe("");
  expect(partOf(whole, "showingPage")).toBe("");
  expect(partName(whole, "")).toBe("justus");
  expect(partName(whole, "join")).toBe("join");
});

test("every state and edge is in exactly one part", () => {
  const parts = partsOf(whole).map((part) => partMachine(whole, part));
  for (const state of whole.states) {
    expect(parts.filter((part) => part.states.includes(state))).toHaveLength(1);
  }
  for (const edge of whole.edges) {
    expect(parts.filter((part) => part.edges.includes(edge))).toHaveLength(1);
  }
});

test("a part keeps only its own regions and messages, and starts from its region", () => {
  const join = partMachine(whole, "join");
  expect(join.regions).toEqual(["join"]);
  expect(join.actors).toEqual([]);
  expect(join.initial).toBeNull();
  expect(join.id).toBe("join");
  for (const message of join.fuzz?.messages ?? []) {
    expect(partOf(whole, message.from)).toBe("join");
    expect(partOf(whole, message.to)).toBe("join");
  }
  const own = partMachine(whole, "");
  expect(own.initial).toBe(whole.initial);
  expect(own.id).toBe("justus");
  expect(own.regions).not.toContain("join");
});

test("a part of a machine that was not fuzzed stays unfuzzed", () => {
  expect(partMachine({ ...whole, fuzz: null }, "join").fuzz).toBeNull();
});
