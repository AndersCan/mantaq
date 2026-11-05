import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDoorActor } from "./fixtures/factories.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { designErrors, expectNoDesignErrors, unreachableStates } from "./gate.ts";
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

const sender = state("sender")();
const ping = event("ping")();
const hop = event("hop")();

function createUnhandledSendActor() {
  return Actor({
    clock: VirtualClock(),
    inputs: [go],
    internal: [ping],
    states: [sender],
    initial: sender,
    setup: (m) => {
      m.effect(sender, { name: "notify", sends: [ping], fn: () => undefined });
      m.on(sender, { event: go, to: [sender], handler: () => ({ state: sender }) });
    },
  });
}

function createAnyActor(withAnyTarget: boolean) {
  return Actor({
    clock: VirtualClock(),
    inputs: [go, hop],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
      m.on(running, { event: go, to: [running], handler: () => ({ state: running }) });
      if (withAnyTarget) m.onAny({ event: hop, to: [orphan], handler: () => ({ state: orphan }) });
    },
  });
}

describe("design error details", () => {
  test("reports an effect that sends an event its state does not handle", () => {
    const { machine } = inspect({
      id: "send",
      create: () => createUnhandledSendActor(),
      fuzz: false,
    });
    expect(designErrors(machine)).toEqual([
      "effect notify in sender sends ping, but sender has no handler for it",
    ]);
  });

  test("a state reached only through onAny is not reported", () => {
    const { machine } = inspect({ id: "any", create: () => createAnyActor(true), fuzz: false });
    expect(unreachableStates(machine)).toEqual([]);
  });

  test("a state no onAny edge reaches is still reported", () => {
    const { machine } = inspect({ id: "any", create: () => createAnyActor(false), fuzz: false });
    expect(unreachableStates(machine)).toEqual(["orphan"]);
  });

  test("an effect edge does not make its target reachable", () => {
    const { machine } = inspect({ id: "orphan", create: () => createOrphanActor(), fuzz: false });
    const edges = [
      ...machine.edges,
      {
        ...machine.edges[0]!,
        id: "effect-edge",
        kind: "effect" as const,
        from: "idle",
        to: "orphan",
      },
    ];
    expect(unreachableStates({ ...machine, edges })).toEqual(["orphan"]);
  });

  test("states of a region are not reported", () => {
    const first = state("first")();
    const second = state("second")();
    const child = Actor({
      clock: VirtualClock(),
      inputs: [go],
      states: [first, second],
      initial: first,
      setup: (m) => {
        m.on(first, { event: go, to: [second], handler: () => ({ state: second }) });
      },
    });
    const { machine } = inspect({
      id: "regions",
      fuzz: false,
      create: () =>
        Actor({
          clock: VirtualClock(),
          inputs: [go],
          states: [idle],
          initial: idle,
          regions: { child },
          setup: (m) => {
            m.on(idle, { event: go, to: [idle], handler: () => ({ state: idle }) });
          },
        }),
    });
    expect(machine.states.map((each) => each.id)).toContain("child.first");
    expect(designErrors(machine)).toEqual([]);
  });

  test("lists thrown, unhandled-send and orphan errors in that order", () => {
    const { machine } = inspect({
      id: "send",
      create: () => createUnhandledSendActor(),
      fuzz: false,
    });
    const withThrow = {
      ...machine,
      states: [
        ...machine.states,
        { ...machine.states[0]!, id: "lost", initial: false, effects: [] },
      ],
      fuzz: { errors: [{ event: "go", from: "sender", message: "boom" }] },
    } as unknown as typeof machine;
    expect(designErrors(withThrow)).toEqual([
      "go in sender throws: boom",
      "effect notify in sender sends ping, but sender has no handler for it",
      "state lost is declared but no path leads to it from the initial state",
    ]);
  });
});
