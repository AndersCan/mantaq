import { expect, test, describe, expectTypeOf } from "vite-plus/test";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { Context, ErrorState } from "@mantaq/core";
import { onOutput } from "../src/output.ts";
import { withTimeout } from "../src/effects/timeout.ts";
import { actorSpec, definePart, use, withParts } from "../src/parts.ts";

const idle = state("idle")();
const loading = state("loading")();
const done = state("done")().final();
const failed = state("failed")();
const wrongState = state("wrong")();

const start = event("start")();
const finish = event("finish")<{ value: number }>();
const fail = event("fail")<{ reason: string }>();
const slow = event("slow")();
const report = event("report")<{ value: number }>();

type LoadContext = { attempts: number; last?: string };

const load = actorSpec({
  inputs: [start, fail, finish],
  internal: [slow],
  outputs: [report],
  states: [idle, loading, done, failed],
  initial: idle,
  context: {} as LoadContext,
});

function newLoad() {
  return { ...load, context: { attempts: 0 } as LoadContext };
}

const startPart = definePart<typeof load>((m) => {
  m.on(idle, start, (_event, opts) => {
    const cur = opts.context.get();
    cur.attempts += 1;
    opts.context.set(cur);
    return { state: loading };
  });
});

const finishPart = definePart<typeof load>((m) => {
  m.on(loading, finish, (event, opts) => {
    const cur = opts.context.get();
    cur.last = `v${event.payload.value}`;
    opts.context.set(cur);
    return { state: done, emit: [report.create({ value: event.payload.value })] };
  });
  m.on(loading, fail, (_event, _opts) => ({ state: failed }));
});

const retryPart = definePart<typeof load>((m) => {
  m.on(failed, start, (_event, opts) => {
    const cur = opts.context.get();
    cur.attempts += 1;
    opts.context.set(cur);
    return { state: loading };
  });
});

const timeoutPart = definePart<typeof load>((m) => {
  m.effect(loading, (input) => {
    withTimeout(5, input, () => slow.create());
  });
  m.on(loading, slow, (_event, _opts) => ({ state: failed }));
});

describe("actorSpec", () => {
  test("returns its input unchanged", () => {
    const spec = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
    });
    expect(spec).toEqual({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
    });
  });

  test("narrows literal tuples so definePart infers exact machine types", () => {
    const spec = actorSpec({
      inputs: [start, fail],
      internal: [],
      states: [idle, loading, done, failed],
      initial: idle,
      context: {} as LoadContext,
    });
    definePart<typeof spec>((m) => {
      m.on(idle, start, (_event, opts) => {
        expectTypeOf(opts.context.get().attempts).toEqualTypeOf<number>();
        return { state: loading };
      });
      m.on(loading, fail, (_event, _opts) => ({ state: failed }));
    });
  });

  test("accepts clock, regions, and internalBudget through the spec", () => {
    const clock = new VirtualClock();
    const spec = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
      context: {} as LoadContext,
      clock,
      internalBudget: 3,
      regions: {} as Record<string, never>,
    });
    expect(spec.clock).toBe(clock);
    expect(spec.internalBudget).toBe(3);
    expect(spec.regions).toEqual({});
  });

  test("accepts an initial payload object", () => {
    const spec = actorSpec({
      inputs: [],
      internal: [],
      states: [idle],
      initial: { state: idle, payload: { seed: 1 } },
    });
    expect(spec.initial).toEqual({ state: idle, payload: { seed: 1 } });
  });
});

describe("definePart + use", () => {
  test("returns a builder closure that registers handlers", () => {
    const actor = new Actor({
      ...newLoad(),
      setup: (m) => {
        use(m, startPart);
        use(m, finishPart);
      },
    });
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    actor.send(finish.create({ value: 7 }));
    expect(actor.state).toBe(done);
    expect(actor.context.attempts).toBe(1);
    expect(actor.context.last).toBe("v7");
  });
});

describe("withParts", () => {
  test("composes parts into a working actor", () => {
    const actor = withParts(newLoad(), [startPart, finishPart]);
    expect(actor.state).toBe(idle);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    actor.send(finish.create({ value: 3 }));
    expect(actor.state).toBe(done);
    expect(actor.context.last).toBe("v3");
  });

  test("accepts a single part without array brackets", () => {
    const actor = withParts(newLoad(), startPart);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    expect(actor.context.attempts).toBe(1);
  });

  test("accepts an inline arrow as a part", () => {
    const actor = withParts(newLoad(), (m) => {
      m.on(idle, start, () => ({ state: loading }));
      m.on(loading, finish, () => ({ state: done }));
    });
    actor.send(start.create());
    actor.send(finish.create({ value: 5 }));
    expect(actor.state).toBe(done);
  });

  test("parts compose: a part can call another part's builder", () => {
    const subA = definePart<typeof load>((m) => {
      m.on(idle, start, () => ({ state: loading }));
    });
    const subB = definePart<typeof load>((m) => {
      m.on(loading, finish, (event, opts) => {
        const cur = opts.context.get();
        cur.last = `v${event.payload.value}`;
        opts.context.set(cur);
        return { state: done };
      });
    });
    const combined = definePart<typeof load>((m) => {
      subA(m);
      subB(m);
    });
    const actor = withParts(newLoad(), combined);
    actor.send(start.create());
    actor.send(finish.create({ value: 9 }));
    expect(actor.state).toBe(done);
    expect(actor.context.last).toBe("v9");
  });

  test("state and onAny handlers both emit, state emit first", () => {
    const emitA = event("emitA")<{ n: number }>();
    const emitB = event("emitB")();
    const go = event("go")();
    const on = state("on")();
    const off = state("off")();
    const pair = actorSpec({
      inputs: [go],
      internal: [],
      outputs: [emitA, emitB],
      states: [on, off],
      initial: off,
      context: {},
    });
    const part = definePart<typeof pair>((m) => {
      m.on(off, go, () => ({ state: on, emit: [emitA.create({ n: 1 })] }));
      m.onAny(go, () => ({ emit: [emitB.create()] }));
    });
    const actor = withParts(pair, part);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (e) => received.push(e));
    actor.send(go.create());
    expect(received).toEqual([{ type: "emitA", payload: { n: 1 } }, { type: "emitB" }]);
  });

  test("transitioning to the same state re-arms a part's effect", async () => {
    const clock = new VirtualClock();
    const bounce = event("bounce")();
    const machine = actorSpec({
      inputs: [start, bounce],
      internal: [slow],
      states: [idle, loading, done],
      initial: idle,
      context: {} as LoadContext,
      clock,
    });
    const part = definePart<typeof machine>((m) => {
      m.on(idle, start, () => ({ state: loading }));
      m.on(loading, bounce, () => ({ state: loading }));
      m.effect(loading, (input) => {
        withTimeout(5, input, () => slow.create());
      });
      m.on(loading, slow, (_event, opts) => {
        const cur = opts.context.get();
        cur.last = "timed-out";
        opts.context.set(cur);
        return { state: done };
      });
    });
    const actor = withParts(machine, part);
    actor.send(start.create());
    actor.send(bounce.create());
    clock.advance(5);
    await actor.settled();
    expect(actor.state).toBe(done);
    expect(actor.context.last).toBe("timed-out");
  });

  test("region child output drives a part handler", () => {
    const go = event("go")();
    const ready = event("ready")();
    const cidle = state("cidle")();
    const cdone = state("cdone")().final();
    const pidle = state("pidle")();
    const active = state("active")();
    const childBase = actorSpec({
      inputs: [go],
      internal: [],
      outputs: [ready],
      states: [cidle, cdone],
      initial: cidle,
      context: {},
    });
    const childPart = definePart<typeof childBase>((m) => {
      m.on(cidle, go, () => ({ state: cdone, emit: [ready.create()] }));
    });
    const parentBase = actorSpec({
      inputs: [ready],
      internal: [],
      states: [pidle, active],
      initial: pidle,
      context: {},
    });
    const parentPart = definePart<typeof parentBase>((m) => {
      m.on(pidle, ready, () => ({ state: active }));
    });
    const child = withParts(childBase, childPart);
    const parent = withParts({ ...parentBase, regions: { worker: child } }, parentPart);
    child.send(go.create());
    expect(parent.state).toBe(active);
    expect(parent.snapshot().regions.worker.path[0]).toBe("cdone");
  });

  test("parts can reference each other's states", () => {
    const actor = withParts(newLoad(), [startPart, finishPart, retryPart]);
    actor.send(start.create());
    actor.send(fail.create({ reason: "boom" }));
    expect(actor.state).toBe(failed);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    expect(actor.context.attempts).toBe(2);
  });

  test("emits from parts flow through declared outputs", () => {
    const actor = withParts(newLoad(), [startPart, finishPart]);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (e) => received.push(e));
    actor.send(start.create());
    actor.send(finish.create({ value: 3 }));
    expect(received).toEqual([{ type: "report", payload: { value: 3 } }]);
  });

  test("effects registered in parts run on state entry", async () => {
    const clock = new VirtualClock();
    const actor = withParts({ ...newLoad(), clock }, [startPart, timeoutPart, finishPart]);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    clock.advance(5);
    await actor.settled();
    expect(actor.state).toBe(failed);
  });

  test("onAny parts handle events in any state", () => {
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    const lamp = actorSpec({
      inputs: [toggle],
      internal: [],
      states: [on, off],
      initial: off,
      context: { flips: 0 },
    });
    const flipPart = definePart<typeof lamp>((m) => {
      m.on(off, toggle, () => ({ state: on }));
      m.on(on, toggle, () => ({ state: off }));
      m.onAny(toggle, (_event, opts) => {
        const cur = opts.context.get();
        cur.flips += 1;
        opts.context.set(cur);
        return {};
      });
    });
    const actor = withParts(lamp, [flipPart]);
    actor.send(toggle.create());
    expect(actor.state).toBe(on);
    actor.send(toggle.create());
    expect(actor.state).toBe(off);
    expect(actor.context.flips).toBe(2);
  });

  test("onAny parts can emit through declared outputs", () => {
    const ring = event("ring")();
    const notify = event("notify")<{ msg: string }>();
    const on = state("on")();
    const off = state("off")();
    const bell = actorSpec({
      inputs: [ring],
      internal: [],
      outputs: [notify],
      states: [on, off],
      initial: off,
      context: {},
    });
    const dingPart = definePart<typeof bell>((m) => {
      m.on(off, ring, () => ({ state: on }));
      m.onAny(ring, () => ({ emit: [notify.create({ msg: "ding" })] }));
    });
    const actor = withParts(bell, [dingPart]);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (e) => received.push(e));
    actor.send(ring.create());
    expect(actor.state).toBe(on);
    expect(received).toEqual([{ type: "notify", payload: { msg: "ding" } }]);
  });

  test("later parts overwrite handlers for the same state and event", () => {
    const firstPart = definePart<typeof load>((m) => {
      m.on(idle, start, (_event, opts) => {
        const cur = opts.context.get();
        cur.attempts += 1;
        opts.context.set(cur);
        return { state: failed };
      });
    });
    const secondPart = definePart<typeof load>((m) => {
      m.on(idle, start, () => ({ state: loading }));
    });
    const actor = withParts(newLoad(), [firstPart, secondPart]);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    expect(actor.context.attempts).toBe(0);
  });

  test("effects from different parts accumulate on the same state", async () => {
    const clock = new VirtualClock();
    const countEffect = definePart<typeof load>((m) => {
      m.effect(loading, (input) => {
        const cur = input.context.get();
        cur.attempts += 1;
        input.context.set(cur);
      });
    });
    const actor = withParts({ ...newLoad(), clock }, [startPart, countEffect, timeoutPart]);
    actor.send(start.create());
    expect(actor.context.attempts).toBe(2);
    clock.advance(5);
    await actor.settled();
    expect(actor.state).toBe(failed);
  });

  test("initial state payload flows through withParts", () => {
    const id = state("id")<{ value: string }>();
    const store = actorSpec({
      inputs: [],
      internal: [],
      states: [id],
      initial: { state: id, payload: { value: "seed" } },
      context: {},
    });
    const actor = withParts(store, []);
    expect(actor.state).toBe(id);
    expect(actor.snapshot().payload).toEqual({ value: "seed" });
  });

  test("regions and internal budget pass through withParts", () => {
    const parent = actorSpec({
      inputs: [start, fail],
      internal: [],
      states: [idle, loading, done],
      initial: idle,
      context: {} as LoadContext,
      internalBudget: 3,
      regions: {} as Record<string, never>,
    });
    const actor = withParts(parent, []);
    expect(actor.options.internalBudget).toBe(3);
    expect(actor.options.regions).toEqual({});
  });
});

describe("parts keep full types", () => {
  test("handlers see typed events and context", () => {
    definePart<typeof load>((m) => {
      m.on(loading, finish, (event, opts) => {
        expectTypeOf(event.payload).toEqualTypeOf<{ value: number }>();
        expectTypeOf(opts.context).toEqualTypeOf<Context<LoadContext>>();
        expectTypeOf(opts.context.get().attempts).toEqualTypeOf<number>();
        return { state: done, emit: [report.create({ value: event.payload.value })] };
      });
    });
  });

  test("definePart without a machine generic is a compile error, not silent widening", () => {
    definePart((m) => {
      // @ts-expect-error M defaults to never, so a machineless part cannot register anything
      m.on(idle, start, () => ({ state: loading }));
    });
  });

  test("wrong transition target is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(idle, start, () => ({
        // @ts-expect-error "wrong" is not a declared state
        state: wrongState,
      }));
    });
  });

  test("wrong event payload access is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(loading, finish, (event) => {
        // @ts-expect-error finish payload has no "nope"
        const nope: number = event.payload.nope;
        void nope;
        return { state: done };
      });
    });
  });

  test("wrong context key is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(idle, start, (_event, opts) => {
        // @ts-expect-error LoadContext has no "nope"
        const nope: number = opts.context.get().nope;
        void nope;
        return { state: loading };
      });
    });
  });

  test("emit is rejected when the machine declares no outputs", () => {
    const silent = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
    });
    definePart<typeof silent>((m) => {
      m.on(idle, start, () => ({
        state: loading,
        // @ts-expect-error no outputs declared, so emit is not allowed
        emit: [report.create({ value: 1 })],
      }));
    });
  });

  test("emit of a non-output event is rejected even with outputs declared", () => {
    definePart<typeof load>((m) => {
      m.on(loading, finish, () => ({
        state: done,
        // @ts-expect-error finish is an input, not a declared output
        emit: [finish.create({ value: 1 })],
      }));
    });
  });

  test("withParts infers the actor's context and state types", () => {
    const actor = withParts(load, [startPart]);
    expectTypeOf(actor.context).toEqualTypeOf<LoadContext>();
    expectTypeOf(actor.state).toEqualTypeOf<
      typeof idle | typeof loading | typeof done | typeof failed | ErrorState
    >();
  });

  test("annotated machine options keep full types through definePart", () => {
    const m = actorSpec({
      inputs: [start],
      internal: [slow],
      outputs: [report],
      states: [idle, loading],
      initial: idle,
      context: {} as LoadContext,
    });
    const part = definePart<typeof m>((b) => {
      b.on(idle, slow, (_event, opts) => {
        expectTypeOf(opts.context.get().attempts).toEqualTypeOf<number>();
        return { state: loading, emit: [report.create({ value: 1 })] };
      });
    });
    withParts(m, [part]);
    void part;
  });

  test("a part built for another machine is a compile error", () => {
    const other = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle],
      initial: idle,
    });
    definePart<typeof other>((m) => {
      m.on(idle, start, () => ({
        // @ts-expect-error "done" is not a state of the other machine
        state: done,
      }));
    });
  });

  test("wiring a part into a different machine's withParts is a compile error", () => {
    const other = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, done],
      initial: idle,
      context: {},
    });
    // @ts-expect-error partA was anchored to the load machine, not "other"
    withParts(other, startPart);
  });
});
