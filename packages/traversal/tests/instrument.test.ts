import { expect, test, describe } from "vite-plus/test";
import { instrument } from "../src/instrument.ts";
import { Actor, state, event } from "@mantaq/core";

function createTestActor() {
  const idle = state("idle")();
  const active = state("active")();
  const done = state("done")().final();
  const go = event("GO")();
  const finish = event("FINISH")();

  return new Actor({
    inputs: [go, finish],
    outputs: [],
    internal: [],
    states: [idle, active, done],
    initial: idle,
    context: {} as {},
    effects: {},
    transitions: {
      idle: { GO: () => ({ state: active }) },
      active: { FINISH: () => ({ state: done }) },
    },
  });
}

describe("instrument", () => {
  test("records state visits on send", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    inst.send(go);

    const visits = inst.history.stateVisits();
    expect(visits.length).toBe(2);
    expect(visits[0].stateName).toBe("idle");
    expect(visits[1].stateName).toBe("active");
  });

  test("records transitions", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    inst.send(go);

    const transitions = inst.history.transitions();
    expect(transitions.length).toBe(1);
    expect(transitions[0].from).toBe("idle");
    expect(transitions[0].to).toBe("active");
    expect(transitions[0].event).toBe("GO");
  });

  test("proxies state", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    expect(inst.state.name).toBe("idle");

    const go = event("GO")();
    inst.send(go);

    expect(inst.state.name).toBe("active");
  });

  test("proxies context", () => {
    const idle = state("idle")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: { count: 42 } as { count: number },
      effects: {},
      transitions: {},
    });

    const inst = instrument(actor);
    expect(inst.context).toEqual({ count: 42 });
  });

  test("proxies snapshot", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const snap = inst.snapshot();
    expect(snap.path).toEqual(["idle"]);
    expect(snap.regions).toEqual({});
  });

  test("history grows over multiple sends", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    const finish = event("FINISH")();

    inst.send(go);
    expect(inst.history.entries().length).toBeGreaterThan(0);

    const countAfterFirst = inst.history.entries().length;
    inst.send(finish);
    expect(inst.history.entries().length).toBeGreaterThan(countAfterFirst);

    const transitions = inst.history.transitions();
    expect(transitions.length).toBe(2);
    expect(transitions[0].to).toBe("active");
    expect(transitions[1].to).toBe("done");
  });

  test("records send events", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    inst.send(go);

    const sends = inst.history.sends();
    expect(sends.length).toBe(1);
    expect(sends[0].event).toBe("GO");
  });
});
