import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDoorActor } from "./fixtures/factories.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { expectNoDesignErrors, unreachableStates } from "./gate.ts";
import { inspect } from "./inspect.ts";

const idle = state("idle")();
const running = state("running")();
const orphan = state("orphan")();
const go = event("go")();

function createOrphanActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [go],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
    },
  });
}

describe("expectNoDesignErrors", () => {
  test("passes for a machine without design errors", () => {
    expect(() =>
      expectNoDesignErrors({
        id: "door",
        create: () => createDoorActor(),
        fuzz: { iterations: 100 },
      }),
    ).not.toThrow();
  });

  test("fails on a handler that throws under fuzzing", () => {
    expect(() =>
      expectNoDesignErrors({ id: "throwing", create: () => createThrowingActor() }),
    ).toThrow(/throwing has 1 design error:\n {2}- pick in idle throws/);
  });

  test("fails on a declared state no path leads to", () => {
    expect(() =>
      expectNoDesignErrors({ id: "orphan", create: () => createOrphanActor(), fuzz: false }),
    ).toThrow(/state orphan is declared but no path leads to it/);
  });

  test("lists only states with no path from the initial state", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    expect(unreachableStates(machine)).toEqual(["orphan"]);
  });

  test("an undetermined edge leaves reachability unproven, so nothing is reported", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    const edges = machine.edges.map((edge) => (edge.event === "go" ? { ...edge, to: null } : edge));
    expect(unreachableStates({ ...machine, edges })).toEqual([]);
  });
});
