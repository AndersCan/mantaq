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
    setup: (m) => {
      m.on(idle, go, () => ({ state: active }));
      m.on(active, finish, () => ({ state: done }));
    },
  });
}

describe("instrument", () => {
  test("records state visits on send", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    inst.send(go.create());

    const visits = inst.history.stateVisits();
    expect(visits.length).toBe(2);
    expect(visits[0].stateName).toBe("idle");
    expect(visits[1].stateName).toBe("active");
  });

  test("records transitions", () => {
    const actor = createTestActor();
    const inst = instrument(actor);

    const go = event("GO")();
    inst.send(go.create());

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
    inst.send(go.create());

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
      setup: () => {},
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

    inst.send(go.create());
    expect(inst.history.entries().length).toBeGreaterThan(0);

    const countAfterFirst = inst.history.entries().length;
    inst.send(finish.create());
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
    inst.send(go.create());

    const sends = inst.history.sends();
    expect(sends.length).toBe(1);
    expect(sends[0].event).toBe("GO");
  });

  test("records self-transitions", () => {
    const home = state("home")();
    const reset = event("RESET")();
    const actor = new Actor({
      inputs: [reset],
      outputs: [],
      internal: [],
      states: [home],
      initial: home,
      context: {},
      setup: (m) => {
        m.on(home, reset, () => ({ state: home }));
      },
    });
    const inst = instrument(actor);
    inst.send(reset.create());
    const transitions = inst.history.transitions();
    expect(transitions).toHaveLength(1);
    expect(transitions[0].from).toBe("home");
    expect(transitions[0].to).toBe("home");
    expect(transitions[0].event).toBe("RESET");
  });

  test("records no-op handler invocations without recording state visits", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {},
      setup: (m) => {
        m.onAny(tick, () => ({}));
      },
    });
    const inst = instrument(actor);
    inst.send(tick.create());
    const transitions = inst.history.transitions();
    expect(transitions).toHaveLength(1);
    expect(transitions[0].from).toBe("idle");
    expect(transitions[0].to).toBe("idle");
    expect(inst.history.stateVisits().map((v) => v.stateName)).toEqual(["idle"]);
    expect(inst.history.effects()).toEqual([]);
  });

  test("records cascaded internal events with their own transition records", () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const start = event("START")();
    const next = event("NEXT")();
    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [next],
      states: [a, b, c],
      initial: a,
      context: {},
      setup: (m) => {
        m.on(a, start, () => ({ state: b }));
        m.effect(b, { name: "emitNext", fn: ({ emit }) => emit(next.create()) });
        m.on(b, next, () => ({ state: c }));
      },
    });
    const inst = instrument(actor);
    inst.send(start.create());
    const transitions = inst.history.transitions();
    expect(transitions).toHaveLength(2);
    const seen = new Set(transitions.map((t) => `${t.from}:${t.event}->${t.to}`));
    expect(seen.has("a:START->b")).toBe(true);
    expect(seen.has("b:NEXT->c")).toBe(true);
    expect(inst.history.visitedStates()).toEqual(new Set(["a", "b", "c"]));
    expect(inst.history.effects().map((e) => `${e.stateName}:${e.effectName}`)).toEqual([
      "b:emitNext",
    ]);
  });

  test("self-transitions into an effect-less state record no effect", () => {
    const home = state("home")();
    const reset = event("RESET")();
    const actor = new Actor({
      inputs: [reset],
      outputs: [],
      internal: [],
      states: [home],
      initial: home,
      context: {},
      setup: (m) => {
        m.on(home, reset, () => ({ state: home }));
      },
    });
    const inst = instrument(actor);
    inst.send(reset.create());
    expect(inst.history.transitions()).toHaveLength(1);
    expect(inst.history.effects()).toEqual([]);
  });
});
