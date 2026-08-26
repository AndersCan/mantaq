import { withTimeout } from "./effects/timeout.ts";
import { onOutput } from "./output.ts";
import { actorSpec, definePart, use, withParts } from "./parts.ts";
import type { BuilderOf, Fragment } from "./parts.ts";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type {
  Context,
  ErrorState,
  EventTypeOf,
  InitialState,
  TransitionResult,
} from "@mantaq/core";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";

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

/**
 * Type alias (not interface) so the context stays assignable to
 * `Record<string, unknown>`-based public APIs like `onOutput`.
 */
type LoadContext = {
  attempts: number;
  last?: string;
};

function freshContext(): LoadContext {
  return { attempts: 0 };
}

const load = actorSpec({
  inputs: [start, fail, finish],
  internal: [slow],
  outputs: [report],
  states: [idle, loading, done, failed],
  initial: idle,
  context: freshContext(),
});

function newLoad() {
  return { ...load, context: freshContext() };
}

function nameOf(actor: { state: { name: string } }): string {
  return actor.state.name;
}

const startPart = definePart<typeof load>((m) => {
  m.on(idle, {
    eventRef: start,
    handler: (_event, { context }) => {
      const cur = context.get();
      cur.attempts += 1;
      context.set(cur);
      return { state: loading };
    },
  });
});

const finishPart = definePart<typeof load>((m) => {
  m.on(loading, {
    eventRef: finish,
    handler: (event, { context }) => {
      const cur = context.get();
      cur.last = `v${event.payload.value}`;
      context.set(cur);
      return { state: done, emit: [report.create({ value: event.payload.value })] };
    },
  });
  m.on(loading, { eventRef: fail, handler: (_event) => ({ state: failed }) });
});

const retryPart = definePart<typeof load>((m) => {
  m.on(failed, {
    eventRef: start,
    handler: (_event, { context }) => {
      const cur = context.get();
      cur.attempts += 1;
      context.set(cur);
      return { state: loading };
    },
  });
});

const timeoutPart = definePart<typeof load>((m) => {
  m.effect(loading, {
    name: "startSlowTimer",
    fn: (input) => {
      withTimeout(5, { input, event: () => slow.create() });
    },
  });
  m.on(loading, { eventRef: slow, handler: (_event) => ({ state: failed }) });
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

  test("keeps literal tuples narrow enough for definePart to infer exact machine types", () => {
    const spec = actorSpec({
      inputs: [start, fail],
      internal: [],
      states: [idle, loading, done, failed],
      initial: idle,
      context: freshContext(),
    });
    definePart<typeof spec>((m) => {
      m.on(idle, {
        eventRef: start,
        handler: (_event, { context }) => {
          expectTypeOf(context.get().attempts).toEqualTypeOf<number>();
          return { state: loading };
        },
      });
      m.on(loading, { eventRef: fail, handler: (_event) => ({ state: failed }) });
    });
  });

  test("keeps clock, regions, and internalBudget in the spec", () => {
    const clock = VirtualClock();
    const spec = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
      context: freshContext(),
      clock,
      internalBudget: 3,
      regions: {},
    });
    expect(spec).toEqual({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
      context: freshContext(),
      clock,
      internalBudget: 3,
      regions: {},
    });
  });

  test("returns the given initial payload object in the spec", () => {
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
  test("builds an actor whose registered handlers transition and write context", () => {
    const actor = Actor({
      ...newLoad(),
      setup: (m) => {
        use(m, startPart);
        use(m, finishPart);
      },
    });
    actor.send(start.create());
    actor.send(finish.create({ value: 7 }));
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "done",
      context: { attempts: 1, last: "v7" },
    });
  });
});

describe("withParts", () => {
  test("builds a working actor from composed parts", () => {
    const actor = withParts(newLoad(), startPart, finishPart);
    expect(nameOf(actor)).toBe("idle");
    actor.send(start.create());
    expect(nameOf(actor)).toBe("loading");
    actor.send(finish.create({ value: 3 }));
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "done",
      context: { attempts: 1, last: "v3" },
    });
  });

  test("handles a single part without array brackets", () => {
    const actor = withParts(newLoad(), startPart);
    actor.send(start.create());
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "loading",
      context: { attempts: 1 },
    });
  });

  test("handles an inline arrow as a part", () => {
    const actor = withParts(newLoad(), (m) => {
      m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
      m.on(loading, { eventRef: finish, handler: () => ({ state: done }) });
    });
    actor.send(start.create());
    actor.send(finish.create({ value: 5 }));
    expect(nameOf(actor)).toBe("done");
  });

  test("lets one part call another part's builder", () => {
    const subA = definePart<typeof load>((m) => {
      m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
    });
    const subB = definePart<typeof load>((m) => {
      m.on(loading, {
        eventRef: finish,
        handler: (event, { context }) => {
          const cur = context.get();
          cur.last = `v${event.payload.value}`;
          context.set(cur);
          return { state: done };
        },
      });
    });
    const combined = definePart<typeof load>((m) => {
      subA(m);
      subB(m);
    });
    const actor = withParts(newLoad(), combined);
    actor.send(start.create());
    actor.send(finish.create({ value: 9 }));
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "done",
      context: { attempts: 0, last: "v9" },
    });
  });

  test("emits from both state and onAny handlers with state emit first", () => {
    const emitA = event("emitA")<{ n: number }>();
    const emitB = event("emitB")();
    const goEvent = event("go")();
    const onState = state("on")();
    const off = state("off")();
    const pair = actorSpec({
      inputs: [goEvent],
      internal: [],
      outputs: [emitA, emitB],
      states: [onState, off],
      initial: off,
      context: {},
    });
    const part = definePart<typeof pair>((m) => {
      m.on(off, {
        eventRef: goEvent,
        handler: () => ({ state: onState, emit: [emitA.create({ n: 1 })] }),
      });
      m.onAny({ eventRef: goEvent, handler: () => ({ emit: [emitB.create()] }) });
    });
    const actor = withParts(pair, part);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (emitted) => received.push(emitted));
    actor.send(goEvent.create());
    expect(received).toEqual([{ type: "emitA", payload: { n: 1 } }, { type: "emitB" }]);
  });

  test("calls a part's effect again when transitioning to the same state", async () => {
    const clock = VirtualClock();
    const bounce = event("bounce")();
    const machine = actorSpec({
      inputs: [start, bounce],
      internal: [slow],
      states: [idle, loading, done],
      initial: idle,
      context: freshContext(),
      clock,
    });
    const part = definePart<typeof machine>((m) => {
      m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
      m.on(loading, { eventRef: bounce, handler: () => ({ state: loading }) });
      m.effect(loading, {
        name: "restartBounceTimer",
        fn: (input) => {
          withTimeout(5, { input, event: () => slow.create() });
        },
      });
      m.on(loading, {
        eventRef: slow,
        handler: (_event, { context }) => {
          const cur = context.get();
          cur.last = "timed-out";
          context.set(cur);
          return { state: done };
        },
      });
    });
    const actor = withParts(machine, part);
    actor.send(start.create());
    actor.send(bounce.create());
    clock.advance(5);
    await actor.settled();
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "done",
      context: { attempts: 0, last: "timed-out" },
    });
  });

  test("updates the parent state from region child output", () => {
    const goEvent = event("go")();
    const ready = event("ready")();
    const cidle = state("cidle")();
    const cdone = state("cdone")().final();
    const pidle = state("pidle")();
    const active = state("active")();
    const childBase = actorSpec({
      inputs: [goEvent],
      internal: [],
      outputs: [ready],
      states: [cidle, cdone],
      initial: cidle,
      context: {},
    });
    const childPart = definePart<typeof childBase>((m) => {
      m.on(cidle, { eventRef: goEvent, handler: () => ({ state: cdone, emit: [ready.create()] }) });
    });
    const parentBase = actorSpec({
      inputs: [ready],
      internal: [],
      states: [pidle, active],
      initial: pidle,
      context: {},
    });
    const parentPart = definePart<typeof parentBase>((m) => {
      m.on(pidle, { eventRef: ready, handler: () => ({ state: active }) });
    });
    const child = withParts(childBase, childPart);
    const parent = withParts({ ...parentBase, regions: { worker: child } }, parentPart);
    child.send(goEvent.create());
    expect({
      parentState: parent.state,
      childPath: parent.snapshot().regions.worker.path[0],
    }).toEqual({ parentState: active, childPath: "cdone" });
  });

  test("keeps working when parts reference each other's states", () => {
    const actor = withParts(newLoad(), startPart, finishPart, retryPart);
    actor.send(start.create());
    actor.send(fail.create({ reason: "boom" }));
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "failed",
      context: { attempts: 1 },
    });
    actor.send(start.create());
    expect(nameOf(actor)).toBe("loading");
  });

  test("flows part emits through declared outputs", () => {
    const actor = withParts(newLoad(), startPart, finishPart);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (emitted) => received.push(emitted));
    actor.send(start.create());
    actor.send(finish.create({ value: 3 }));
    expect(received).toEqual([{ type: "report", payload: { value: 3 } }]);
  });

  test("calls effects registered in parts on state entry", async () => {
    const clock = VirtualClock();
    const actor = withParts({ ...newLoad(), clock }, startPart, timeoutPart, finishPart);
    actor.send(start.create());
    expect(nameOf(actor)).toBe("loading");
    clock.advance(5);
    await actor.settled();
    expect(nameOf(actor)).toBe("failed");
  });

  test("handles events with onAny parts in any state", () => {
    const toggle = event("toggle")();
    const onState = state("on")();
    const off = state("off")();
    const lamp = actorSpec({
      inputs: [toggle],
      internal: [],
      states: [onState, off],
      initial: off,
      context: { flips: 0 },
    });
    const flipPart = definePart<typeof lamp>((m) => {
      m.on(off, { eventRef: toggle, handler: () => ({ state: onState }) });
      m.on(onState, { eventRef: toggle, handler: () => ({ state: off }) });
      m.onAny({
        eventRef: toggle,
        handler: (_event, { context }) => {
          const cur = context.get();
          cur.flips += 1;
          context.set(cur);
          return {};
        },
      });
    });
    const actor = withParts(lamp, flipPart);
    actor.send(toggle.create());
    expect(nameOf(actor)).toBe("on");
    actor.send(toggle.create());
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "off",
      context: { flips: 2 },
    });
  });

  test("emits through declared outputs from onAny parts", () => {
    const ring = event("ring")();
    const notify = event("notify")<{ msg: string }>();
    const onState = state("on")();
    const off = state("off")();
    const bell = actorSpec({
      inputs: [ring],
      internal: [],
      outputs: [notify],
      states: [onState, off],
      initial: off,
      context: {},
    });
    const dingPart = definePart<typeof bell>((m) => {
      m.on(off, { eventRef: ring, handler: () => ({ state: onState }) });
      m.onAny({ eventRef: ring, handler: () => ({ emit: [notify.create({ msg: "ding" })] }) });
    });
    const actor = withParts(bell, dingPart);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (emitted) => received.push(emitted));
    actor.send(ring.create());
    expect({ state: nameOf(actor), received }).toEqual({
      state: "on",
      received: [{ type: "notify", payload: { msg: "ding" } }],
    });
  });

  test("treats the last matching handler as the winner when parts target the same state and event", () => {
    const firstPart = definePart<typeof load>((m) => {
      m.on(idle, {
        eventRef: start,
        handler: (_event, { context }) => {
          const cur = context.get();
          cur.attempts += 1;
          context.set(cur);
          return { state: failed };
        },
      });
    });
    const secondPart = definePart<typeof load>((m) => {
      m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
    });
    const actor = withParts(newLoad(), firstPart, secondPart);
    actor.send(start.create());
    expect({ state: nameOf(actor), context: actor.context }).toEqual({
      state: "loading",
      context: { attempts: 0 },
    });
  });

  test("adds effects from different parts onto the same state", async () => {
    const clock = VirtualClock();
    const countEffect = definePart<typeof load>((m) => {
      m.effect(loading, {
        name: "countAttempts",
        fn: (input) => {
          const cur = input.context.get();
          cur.attempts += 1;
          input.context.set(cur);
        },
      });
    });
    const actor = withParts({ ...newLoad(), clock }, startPart, countEffect, timeoutPart);
    actor.send(start.create());
    expect(actor.context.attempts).toBe(2);
    clock.advance(5);
    await actor.settled();
    expect(nameOf(actor)).toBe("failed");
  });

  test("keeps an initial state payload through withParts", () => {
    const idState = state("id")<{ value: string }>();
    const store = actorSpec({
      inputs: [],
      internal: [],
      states: [idState],
      initial: { state: idState, payload: { value: "seed" } },
      context: {},
    });
    const actor = withParts(store);
    expect(nameOf(actor)).toBe("id");
    expect(actor.snapshot().payload).toEqual({ value: "seed" });
  });

  test("returns regions and internal budget through withParts", () => {
    const parent = actorSpec({
      inputs: [start, fail],
      internal: [],
      states: [idle, loading, done],
      initial: idle,
      context: freshContext(),
      internalBudget: 3,
      regions: {},
    });
    const actor = withParts(parent);
    expect({ budget: actor.options?.internalBudget, regions: actor.options?.regions }).toEqual({
      budget: 3,
      regions: {},
    });
  });
});

describe("parts keep full types", () => {
  test("resolves exact event and context types inside handlers", () => {
    definePart<typeof load>((m) => {
      m.on(loading, {
        eventRef: finish,
        handler: (event, { context }) => {
          expectTypeOf(event.payload).toEqualTypeOf<{ value: number }>();
          expectTypeOf(context).toEqualTypeOf<Context<LoadContext>>();
          expectTypeOf(context.get().attempts).toEqualTypeOf<number>();
          return { state: done, emit: [report.create({ value: event.payload.value })] };
        },
      });
    });
  });

  test("rejects handler registration on a machineless part at compile time", () => {
    type MachinelessBuilder = BuilderOf<never>;
    expectTypeOf<Parameters<MachinelessBuilder["on"]>[0]>().toEqualTypeOf<never>();
    definePart((m) => {
      expectTypeOf(m).toEqualTypeOf<MachinelessBuilder>();
    });
  });

  test("rejects a wrong transition target at compile time", () => {
    expectTypeOf(load.states).toEqualTypeOf<
      readonly [typeof idle, typeof loading, typeof done, typeof failed]
    >();
    expectTypeOf(wrongState).not.toMatchTypeOf<(typeof load.states)[number]>();
  });

  test("returns only the declared payload on handler events", () => {
    definePart<typeof load>((m) => {
      m.on(loading, {
        eventRef: finish,
        handler: (event) => {
          expectTypeOf(event.payload).toEqualTypeOf<{ value: number }>();
          return { state: done };
        },
      });
    });
  });

  test("returns only the declared context to handlers", () => {
    definePart<typeof load>((m) => {
      m.on(idle, {
        eventRef: start,
        handler: (_event, { context }) => {
          expectTypeOf(context.get()).toEqualTypeOf<LoadContext>();
          return { state: loading };
        },
      });
    });
  });

  test("rejects emit when the machine declares no outputs", () => {
    const silent = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, loading],
      initial: idle,
    });
    expectTypeOf({ state: loading, emit: [report.create({ value: 1 })] }).not.toMatchTypeOf<
      TransitionResult<(typeof silent.states)[number], never>
    >();
  });

  test("rejects emitting a non-output event even with outputs declared", () => {
    expectTypeOf({ state: done, emit: [finish.create({ value: 1 })] }).not.toMatchTypeOf<
      TransitionResult<
        (typeof load.states)[number],
        EventTypeOf<NonNullable<typeof load.outputs>[number]>
      >
    >();
  });

  test("resolves the actor's context and state types through withParts", () => {
    const actor = withParts(load, startPart);
    expectTypeOf(actor.context).toEqualTypeOf<LoadContext>();
    expectTypeOf(actor.state).toEqualTypeOf<
      typeof idle | typeof loading | typeof done | typeof failed | ErrorState
    >();
  });

  test("keeps full types through definePart with annotated machine options", () => {
    const annotated = actorSpec({
      inputs: [start],
      internal: [slow],
      outputs: [report],
      states: [idle, loading],
      initial: idle,
      context: freshContext(),
    });
    const part = definePart<typeof annotated>((b) => {
      b.on(idle, {
        eventRef: slow,
        handler: (_event, { context }) => {
          expectTypeOf(context.get().attempts).toEqualTypeOf<number>();
          return { state: loading, emit: [report.create({ value: 1 })] };
        },
      });
    });
    withParts(annotated, part);
  });

  test("rejects a part built for another machine at compile time", () => {
    const other = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle],
      initial: idle,
    });
    expectTypeOf(done).not.toMatchTypeOf<(typeof other.states)[number]>();
  });

  test("rejects wiring a part into a different machine's withParts at compile time", () => {
    const other = actorSpec({
      inputs: [start],
      internal: [],
      states: [idle, done],
      initial: idle,
      context: {},
    });
    expectTypeOf(startPart).not.toMatchTypeOf<Fragment<typeof other>>();
  });

  test("rejects an initial state outside the states tuple at compile time", () => {
    expectTypeOf(done).not.toMatchTypeOf<InitialState<typeof idle | typeof loading>>();
  });

  test("rejects a bare state ref when the state requires an initial payload at compile time", () => {
    const needsPayload = state("needs-payload")<{ seed: number }>();
    expectTypeOf(needsPayload).not.toMatchTypeOf<InitialState<typeof needsPayload>>();
  });

  test("keeps a payload object for a payload-required initial state", () => {
    const needsPayload = state("needs-payload")<{ seed: number }>();
    const spec = actorSpec({
      inputs: [],
      internal: [],
      states: [needsPayload],
      initial: { state: needsPayload, payload: { seed: 1 } },
    });
    expect(spec.initial).toEqual({ state: needsPayload, payload: { seed: 1 } });
  });
});
