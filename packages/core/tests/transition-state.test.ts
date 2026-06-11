import { expect, test, describe } from "vite-plus/test";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { Actor, VirtualClock } from "../src/actor.ts";

describe("StateRef.create()", () => {
  test("returns plain object with state ref and payload", () => {
    const s = state("active")<{ x: number; y: number }>();
    const result = s.create({ x: 10, y: 20 });
    expect(result.state).toBe(s);
    expect(result.state.name).toBe("active");
    expect(result.payload).toEqual({ x: 10, y: 20 });
  });

  test("returns plain object with undefined payload", () => {
    const s = state("idle")();
    const result = s.create(undefined);
    expect(result.state).toBe(s);
    expect(result.payload).toBeUndefined();
  });

  test("returns plain object with complex nested payload", () => {
    const s = state("loaded")<{
      items: string[];
      meta: { count: number; tags: Set<string> };
    }>();
    const payload = {
      items: ["a", "b", "c"],
      meta: { count: 3, tags: new Set(["x", "y"]) },
    };
    const result = s.create(payload);
    expect(result.payload).toEqual(payload);
    expect(result.payload.items).toHaveLength(3);
    expect(result.payload.meta.tags.has("x")).toBe(true);
  });

  test("returns plain object with null payload", () => {
    const s = state("cleared")<string | null>();
    const result = s.create(null);
    expect(result.payload).toBeNull();
  });

  test("payload reference identity", () => {
    const s = state("ref")<{ val: number }>();
    const obj = { val: 42 };
    const result = s.create(obj);
    expect(result.payload).toBe(obj);
  });

  test("same state ref used in multiple creates", () => {
    const s = state("shared")<{ id: number }>();
    const r1 = s.create({ id: 1 });
    const r2 = s.create({ id: 2 });
    expect(r1.state).toBe(r2.state);
    expect(r1.state.name).toBe("shared");
    expect(r1.payload).not.toBe(r2.payload);
    expect(r1.payload.id).toBe(1);
    expect(r2.payload.id).toBe(2);
  });

  test("create() returns plain object with correct shape", () => {
    const s = state("check")();
    const result = s.create(undefined);
    expect(result).toEqual({ state: s, payload: undefined });
    expect(Object.keys(result)).toEqual(["state", "payload"]);
  });
});

describe("create() in actor transitions", () => {
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
            state: loading.create({ url: (e as { url: string }).url }),
          }),
        },
        loading: {
          done: () => ({ state: success }),
        },
      },
    });

    return { actor, load, done, idle, loading, success };
  }

  test("send() with create() sets state correctly", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    expect(actor.state.name).toBe("loading");
  });

  test("create() payload reaches effect handler", () => {
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
            state: loading.create({ url: (e as { url: string }).url }),
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

  test("create() in initial state", () => {
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
      initial: idle.create({ start: true }),
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
      initial: s1.create({ count: 0 }),
      clock,
      effects: {
        s1: [({ state: s }) => payloads.push(s.payload)],
        s2: [({ state: s }) => payloads.push(s.payload)],
        s3: [({ state: s }) => payloads.push(s.payload)],
      },
      transitions: {
        s1: {
          advance: () => ({ state: s2.create({ count: 1 }) }),
        },
        s2: {
          advance: () => ({ state: s3.create({ count: 2 }) }),
        },
      },
    });

    actor.send(advance.create({ step: 1 }));
    expect(actor.state.name).toBe("s2");
    actor.send(advance.create({ step: 2 }));
    expect(actor.state.name).toBe("s3");

    expect(payloads).toEqual([{ count: 1 }, { count: 2 }]);
  });

  test("create() with empty object payload", () => {
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
          go: () => ({ state: b.create({}) }),
        },
      },
    });

    actor.send(go.create(undefined));
    expect(actor.state.name).toBe("b");
  });
});
