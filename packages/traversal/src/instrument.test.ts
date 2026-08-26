import { instrument } from "./instrument.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function createTestActor() {
  const idleState = state("idle")();
  const activeState = state("active")();
  const doneState = state("done")().final();
  const goEvent = event("GO")();
  const finishEvent = event("FINISH")();

  return Actor({
    inputs: [goEvent, finishEvent],
    outputs: [],
    internal: [],
    states: [idleState, activeState, doneState],
    initial: idleState,
    setup: (machine) => {
      machine.on(idleState, { eventRef: goEvent, handler: () => ({ state: activeState }) });
      machine.on(activeState, { eventRef: finishEvent, handler: () => ({ state: doneState }) });
    },
  });
}

describe("instrument", () => {
  test("emits state visit entries on send", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    const goEvent = event("GO")();
    instrumented.send(goEvent.create());

    expect(instrumented.history.stateVisits().map((visit) => visit.stateName)).toEqual([
      "idle",
      "active",
    ]);
  });

  test("emits transition entries with prefixed from, to and event", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    const goEvent = event("GO")();
    instrumented.send(goEvent.create());

    expect(instrumented.history.transitions()).toEqual([
      { from: "idle", event: "GO", to: "active" },
    ]);
  });

  test("keeps the proxied state in sync with the wrapped actor", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    const goEvent = event("GO")();
    instrumented.send(goEvent.create());
    expect(instrumented.state.name).toBe("active");
  });

  test("returns the wrapped context unchanged", () => {
    const idleState = state("idle")();
    const tickEvent = event("TICK")();

    const actor = Actor({
      inputs: [tickEvent],
      outputs: [],
      internal: [],
      states: [idleState],
      initial: idleState,
      context: { count: 42 },
      setup: () => {},
    });

    const instrumented = instrument(actor);
    expect(instrumented.context).toEqual({ count: 42 });
  });

  test("returns snapshots that read through to the wrapped actor", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    expect(instrumented.snapshot()).toEqual({
      path: ["idle"],
      context: {},
      payload: undefined,
      regions: {},
    });
  });

  test("adds history entries across multiple sends", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    const goEvent = event("GO")();
    const finishEvent = event("FINISH")();

    instrumented.send(goEvent.create());
    const countAfterFirstSend = instrumented.history.entries().length;
    expect(countAfterFirstSend).toBeGreaterThan(0);

    instrumented.send(finishEvent.create());
    expect(instrumented.history.entries().length).toBeGreaterThan(countAfterFirstSend);

    expect(instrumented.history.transitions().map((record) => record.to)).toEqual([
      "active",
      "done",
    ]);
  });

  test("adds every sent event as a send entry", () => {
    const actor = createTestActor();
    const instrumented = instrument(actor);

    const goEvent = event("GO")();
    instrumented.send(goEvent.create());

    expect(instrumented.history.sends()).toEqual([{ event: "GO" }]);
  });

  test("creates self-transition entries with matching from and to", () => {
    const homeState = state("home")();
    const resetEvent = event("RESET")();
    const actor = Actor({
      inputs: [resetEvent],
      outputs: [],
      internal: [],
      states: [homeState],
      initial: homeState,
      setup: (machine) => {
        machine.on(homeState, { eventRef: resetEvent, handler: () => ({ state: homeState }) });
      },
    });

    const instrumented = instrument(actor);
    instrumented.send(resetEvent.create());
    expect(instrumented.history.transitions()).toEqual([
      { from: "home", event: "RESET", to: "home" },
    ]);
  });

  test("creates transition entries for no-op handlers without adding state visits", () => {
    const idleState = state("idle")();
    const tickEvent = event("TICK")();
    const actor = Actor({
      inputs: [tickEvent],
      outputs: [],
      internal: [],
      states: [idleState],
      initial: idleState,
      setup: (machine) => {
        machine.onAny({ eventRef: tickEvent, handler: () => ({}) });
      },
    });

    const instrumented = instrument(actor);
    instrumented.send(tickEvent.create());
    expect(instrumented.history.transitions()).toEqual([
      { from: "idle", event: "TICK", to: "idle" },
    ]);
    expect(instrumented.history.stateVisits().map((visit) => visit.stateName)).toEqual(["idle"]);
    expect(instrumented.history.effects()).toEqual([]);
  });

  test("creates separate transition entries for cascaded internal events", () => {
    const startState = state("start")();
    const middleState = state("middle")();
    const endState = state("end")();
    const startEvent = event("START")();
    const nextEvent = event("NEXT")();

    const actor = Actor({
      inputs: [startEvent],
      outputs: [],
      internal: [nextEvent],
      states: [startState, middleState, endState],
      initial: startState,
      setup: (machine) => {
        machine.on(startState, { eventRef: startEvent, handler: () => ({ state: middleState }) });
        machine.effect(middleState, {
          name: "emitNext",
          fn: ({ emit }) => emit(nextEvent.create()),
        });
        machine.on(middleState, { eventRef: nextEvent, handler: () => ({ state: endState }) });
      },
    });

    const instrumented = instrument(actor);
    instrumented.send(startEvent.create());
    const recordedPairs = instrumented.history
      .transitions()
      .map((record) => `${record.from}:${record.event}->${record.to}`)
      .sort();
    expect(recordedPairs).toEqual(["middle:NEXT->end", "start:START->middle"]);
    expect(instrumented.history.visitedStates()).toEqual(new Set(["start", "middle", "end"]));
    expect(
      instrumented.history.effects().map((effect) => `${effect.stateName}:${effect.effectName}`),
    ).toEqual(["middle:emitNext"]);
  });

  test("skips effect records when a self-transition enters an effect-less state", () => {
    const homeState = state("home")();
    const resetEvent = event("RESET")();
    const actor = Actor({
      inputs: [resetEvent],
      outputs: [],
      internal: [],
      states: [homeState],
      initial: homeState,
      setup: (machine) => {
        machine.on(homeState, { eventRef: resetEvent, handler: () => ({ state: homeState }) });
      },
    });

    const instrumented = instrument(actor);
    instrumented.send(resetEvent.create());
    expect(instrumented.history.transitions()).toEqual([
      { from: "home", event: "RESET", to: "home" },
    ]);
    expect(instrumented.history.effects()).toEqual([]);
  });
});
