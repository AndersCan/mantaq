import { expect, test, describe } from "vite-plus/test";
import { state, TransitionState, StateRef } from "../src/state.ts";
import { event } from "../src/event.ts";
import { Actor, VirtualClock } from "../src/actor.ts";

describe("TransitionState", () => {
  test("construction with typed payload", () => {
    const s = state("active")<{ x: number; y: number }>();
    const ts = new TransitionState(s, { x: 10, y: 20 });
    expect(ts.__stateRef).toBe(s);
    expect(ts.__stateRef.name).toBe("active");
    expect(ts.__payload).toEqual({ x: 10, y: 20 });
  });

  test("construction with undefined payload", () => {
    const s = state("idle")();
    const ts = new TransitionState(s, undefined);
    expect(ts.__stateRef).toBe(s);
    expect(ts.__payload).toBeUndefined();
  });

  test("construction with complex nested payload", () => {
    const s = state("loaded")<{
      items: string[];
      meta: { count: number; tags: Set<string> };
    }>();
    const payload = {
      items: ["a", "b", "c"],
      meta: { count: 3, tags: new Set(["x", "y"]) },
    };
    const ts = new TransitionState(s, payload);
    expect(ts.__payload).toEqual(payload);
    expect(ts.__payload.items).toHaveLength(3);
    expect(ts.__payload.meta.tags.has("x")).toBe(true);
  });

  test("construction with null payload", () => {
    const s = state("cleared")<string | null>();
    const ts = new TransitionState(s, null);
    expect(ts.__payload).toBeNull();
  });

  test("payload reference identity", () => {
    const s = state("ref")<{ val: number }>();
    const obj = { val: 42 };
    const ts = new TransitionState(s, obj);
    expect(ts.__payload).toBe(obj);
  });

  test("same state ref used in multiple TransitionStates", () => {
    const s = state("shared")<{ id: number }>();
    const ts1 = new TransitionState(s, { id: 1 });
    const ts2 = new TransitionState(s, { id: 2 });
    expect(ts1.__stateRef).toBe(ts2.__stateRef);
    expect(ts1.__stateRef.name).toBe("shared");
    expect(ts1.__payload).not.toBe(ts2.__payload);
    expect(ts1.__payload.id).toBe(1);
    expect(ts2.__payload.id).toBe(2);
  });

  test("TransitionState is not a StateRef", () => {
    const s = state("check")();
    const ts = new TransitionState(s, undefined);
    expect(ts).toBeInstanceOf(TransitionState);
    expect(ts).not.toBeInstanceOf(StateRef);
  });
});

describe("TransitionState in actor transitions", () => {
  function makeActor(clock: VirtualClock) {
    const load = event("load")<{ url: string }>();
    const done = event("done")<{ data: string }>();

    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();
    const success = state("success")<{ data: string }>();

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, loading, success],
      initial: idle,
      clock,
      transitions: {
        idle: {
          load: (e) => ({
            state: new TransitionState(loading, { url: (e as { url: string }).url }),
          }),
        },
        loading: {
          done: () => ({ state: success }),
        },
      },
    });

    return { actor, load, done, idle, loading, success };
  }

  test("send() with TransitionState sets state correctly", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    expect(actor.state.name).toBe("loading");
  });

  test("TransitionState payload reaches effect handler", () => {
    const clock = new VirtualClock();
    const load = event("load")<{ url: string }>();
    const done = event("done")();

    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();
    const success = state("success")();

    let capturedPayload: unknown;

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, loading, success],
      initial: idle,
      clock,
      effects: {
        loading: [
          ({ state: actorState }) => {
            capturedPayload = actorState.payload;
          },
        ],
      },
      transitions: {
        idle: {
          load: (e) => ({
            state: new TransitionState(loading, { url: (e as { url: string }).url }),
          }),
        },
        loading: {
          done: () => ({ state: success }),
        },
      },
    });

    actor.send(load.create({ url: "/api/data" }));
    expect(capturedPayload).toEqual({ url: "/api/data" });
  });

  test("TransitionState in initial state", () => {
    const clock = new VirtualClock();
    const done = event("done")();

    const idle = state("idle")<{ start: boolean }>();
    const active = state("active")();
    const done_state = state("done")();

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [done],
      context: {},
      states: [idle, active, done_state],
      initial: new TransitionState(idle, { start: true }),
      clock,
      transitions: {
        idle: {
          done: () => ({ state: active }),
        },
        active: {
          done: () => ({ state: done_state }),
        },
      },
    });

    expect(actor.state.name).toBe("idle");
    actor.send(done.create(undefined));
    expect(actor.state.name).toBe("active");
  });

  test("chained transitions with different payloads", () => {
    const clock = new VirtualClock();
    const advance = event("advance")<{ step: number }>();

    const s1 = state("s1")<{ count: number }>();
    const s2 = state("s2")<{ count: number }>();
    const s3 = state("s3")<{ count: number }>();

    const payloads: unknown[] = [];

    const actor = new Actor({
      inputs: [advance],
      outputs: [],
      internal: [],
      context: {},
      states: [s1, s2, s3],
      initial: new TransitionState(s1, { count: 0 }),
      clock,
      effects: {
        s1: [({ state: s }) => payloads.push(s.payload)],
        s2: [({ state: s }) => payloads.push(s.payload)],
        s3: [({ state: s }) => payloads.push(s.payload)],
      },
      transitions: {
        s1: {
          advance: () => ({ state: new TransitionState(s2, { count: 1 }) }),
        },
        s2: {
          advance: () => ({ state: new TransitionState(s3, { count: 2 }) }),
        },
      },
    });

    actor.send(advance.create({ step: 1 }));
    expect(actor.state.name).toBe("s2");
    actor.send(advance.create({ step: 2 }));
    expect(actor.state.name).toBe("s3");

    expect(payloads).toEqual([{ count: 1 }, { count: 2 }]);
  });

  test("TransitionState with empty object payload", () => {
    const clock = new VirtualClock();
    const go = event("go")();

    const a = state("a")();
    const b = state("b")<Record<string, never>>();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      context: {},
      states: [a, b],
      initial: a,
      clock,
      transitions: {
        a: {
          go: () => ({ state: new TransitionState(b, {}) }),
        },
      },
    });

    actor.send(go.create(undefined));
    expect(actor.state.name).toBe("b");
  });
});
