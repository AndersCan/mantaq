import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "../src/virtual-clock.ts";
import { RealClock } from "../src/real-clock.ts";
import { InternalQueue } from "../src/queue.ts";
import { trackAbort } from "../src/abort-tracker.ts";
import { runEffects } from "../src/effects.ts";
import { Subscribers } from "../src/subscribers.ts";
import { Context } from "../src/context.ts";
import { Actor } from "../src/actor.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import type { InternalEvent } from "../src/event.ts";
import type { AnyStateRef } from "../src/state.ts";
import type { AnyActor } from "../src/actor-internal.ts";

describe("VirtualClock", () => {
  test("timer ids increase across calls", () => {
    const clock = new VirtualClock();
    const a = clock.setTimeout(10, () => {});
    const b = clock.setTimeout(20, () => {});
    expect(a).toBe(1);
    expect(b).toBe(2);
    const c = clock.setInterval(10, () => {});
    const d = clock.setInterval(20, () => {});
    expect(c).toBe(3);
    expect(d).toBe(4);
  });

  test("timers fire in deadline order", () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    clock.setTimeout(10, () => order.push(1));
    clock.setTimeout(20, () => order.push(2));
    clock.advance(30);
    expect(order).toEqual([1, 2]);
  });

  test("intervals fire in next-deadline order", () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    clock.setInterval(10, () => order.push(1));
    clock.setInterval(20, () => order.push(2));
    clock.advance(30);
    expect(order[0]).toBe(1);
  });

  test("an interval due exactly at the target fires", () => {
    const clock = new VirtualClock();
    let count = 0;
    clock.setInterval(20, () => count++);
    clock.advance(20);
    expect(count).toBe(1);
  });

  test("an interval does not fire before its deadline", () => {
    const clock = new VirtualClock();
    let c1 = 0;
    let c2 = 0;
    clock.setInterval(10, () => c1++);
    clock.setInterval(30, () => c2++);
    clock.advance(25);
    expect(c1).toBe(2);
    expect(c2).toBe(0);
  });

  test("hasPending is true with only intervals scheduled", () => {
    const clock = new VirtualClock();
    clock.setInterval(10, () => {});
    expect(clock.hasPending()).toBe(true);
  });

  test("pendingTimers reports remaining ms after advance", () => {
    const clock = new VirtualClock();
    clock.advance(5);
    clock.setTimeout(30, () => {}, { eventName: "t" });
    const pending = clock.pendingTimers();
    expect(pending).toHaveLength(1);
    expect(pending[0].ms).toBe(30);
  });
});

describe("RealClock", () => {
  test("now is relative to construction, not epoch time", () => {
    const clock = new RealClock();
    expect(clock.now()).toBeLessThan(1000);
  });

  test("setTimeout with options but no signal still schedules", () => {
    const clock = new RealClock();
    let fired = false;
    const id = clock.setTimeout(
      5,
      () => {
        fired = true;
      },
      {},
    );
    expect(typeof id).toBe("number");
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(true);
        resolve();
      }, 40),
    );
  });

  test("a fired timeout removes its abort listener", async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    const calls: number[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = ((id: number) => {
      calls.push(id);
      return original(id);
    }) as typeof clearTimeout;
    try {
      let fired = false;
      const id = clock.setTimeout(
        5,
        () => {
          fired = true;
        },
        { signal: controller.signal },
      );
      const deadline = Date.now() + 100;
      while (!fired && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(fired).toBe(true);
      controller.abort();
      expect(calls).not.toContain(id);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  test("the timeout abort listener fires only once", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    const calls: number[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = ((id: number) => {
      calls.push(id);
      return original(id);
    }) as typeof clearTimeout;
    try {
      const id = clock.setTimeout(50, () => {}, { signal: controller.signal });
      controller.signal.dispatchEvent(new Event("abort"));
      controller.signal.dispatchEvent(new Event("abort"));
      expect(calls.filter((c) => c === id)).toHaveLength(1);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  test("the interval abort listener fires only once", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    const calls: number[] = [];
    const original = globalThis.clearInterval;
    globalThis.clearInterval = ((id: number) => {
      calls.push(id);
      return original(id);
    }) as typeof clearInterval;
    try {
      const id = clock.setInterval(1000, () => {}, { signal: controller.signal });
      controller.signal.dispatchEvent(new Event("abort"));
      controller.signal.dispatchEvent(new Event("abort"));
      expect(calls.filter((c) => c === id)).toHaveLength(1);
    } finally {
      globalThis.clearInterval = original;
    }
  });
});

describe("InternalQueue", () => {
  test("length is the remaining count while processing", () => {
    const queue = new InternalQueue();
    const lens: number[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable(() => {
      lens.push(queue.length);
      return true;
    });
    expect(lens).toEqual([2, 1, 0]);
  });

  test("settled resolves without a process call when idle", async () => {
    const queue = new InternalQueue();
    expect(queue.settled()).toBeInstanceOf(Promise);
    let resolved = false;
    void queue.settled().then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
  });

  test("settled stays pending while events are queued", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    let resolved = false;
    const p = queue.settled();
    void p.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);
    queue.processCancellable(() => true);
    await p;
  });

  test("a cancelled process does not leak stopped state", () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    queue.processCancellable(() => false);
    queue.push({ type: "B" });
    expect(queue.length).toBe(1);
    queue.processCancellable(() => true);
    expect(queue.length).toBe(0);
  });

  test("nested process calls are ignored while processing", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" });
    queue.processCancellable((e) => {
      if (e.type === "A") {
        queue.processCancellable((inner) => {
          seen.push(`inner:${inner.type}`);
          return true;
        });
      } else {
        seen.push(`outer:${e.type}`);
      }
      return true;
    });
    expect(seen).toEqual(["outer:B"]);
  });
});

describe("abort-tracker", () => {
  test("trackAbort listener fires only once across repeated abort events", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    const controller = new AbortController();
    trackAbort(controller.signal, 1, map);
    controller.signal.dispatchEvent(new Event("abort"));
    map.set(1, { signal: controller.signal });
    controller.signal.dispatchEvent(new Event("abort"));
    expect(map.has(1)).toBe(true);
  });
});

describe("runEffects", () => {
  test("runs effects for final states when declared", () => {
    const seen: string[] = [];
    const result = runEffects({
      effects: {
        done: [
          {
            name: "recordRun",
            fn: () => {
              seen.push("ran");
            },
          },
        ],
      },
      state: state("done")().final(),
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: state("done")().final(), context: {} },
      onError: () => {},
    });
    expect(result.pending).toEqual([]);
    expect(seen).toEqual(["ran"]);
  });

  test("returns no pending for an empty effect list", () => {
    const result = runEffects({
      effects: { idle: [] },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: state("idle")(), context: {} },
      onError: () => {},
    });
    expect(result.pending).toEqual([]);
  });
});

describe("Actor state entry directed mutation tests", () => {
  test("initial state effects run at construction with the synthetic __init event", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    let sawEvent: InternalEvent | undefined;
    const actor = new Actor({
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "recordInitEvent",
          fn: ({ event: e, emit }) => {
            sawEvent = e;
            emit(tick.create());
          },
        });
        m.on(idle, tick, () => ({ state: done }));
      },
    });
    expect(sawEvent?.type).toBe("__init");
    expect(actor.snapshot().path[0]).toBe("done");
    expect(actor.snapshot().done).toBe(true);
  });

  test("initial state effect arms a timer that completes the machine at the deadline", () => {
    const clock = new VirtualClock();
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const actor = new Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "armDeadlineTimer",
          fn: ({ clock: c, emit }) => {
            c.setTimeout(100, () => emit(tick.create()));
          },
        });
        m.on(idle, tick, () => ({ state: done }));
      },
    });
    expect(actor.snapshot().path[0]).toBe("idle");
    clock.advance(99);
    expect(actor.snapshot().path[0]).toBe("idle");
    clock.advance(1);
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("#pendingEffects is pruned as async effects settle", async () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: idle }));
        m.effect(idle, {
          name: "settleAsync",
          fn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        });
      },
    });
    for (let i = 0; i < 200; i++) actor.send(go.create());
    await actor.settled();
    expect(actor.pendingEffectCount()).toBe(0);
  });

  test("dispose clears the pending effects set", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: idle }));
        m.effect(idle, {
          name: "hangAsync",
          fn: () => new Promise<void>(() => {}),
        });
      },
    });
    for (let i = 0; i < 50; i++) actor.send(go.create());
    expect(actor.pendingEffectCount()).toBe(51);
    actor.dispose();
    expect(actor.pendingEffectCount()).toBe(0);
  });

  test("emit after the effect aborts is a silent no-op", () => {
    const idle = state("idle")();
    const running = state("running")();
    const go = event("GO")();
    const stop = event("STOP")();
    const out = event("OUT")();
    const received: string[] = [];
    let savedEmit: ((e: InternalEvent) => void) | undefined;
    const actor = new Actor({
      inputs: [go, stop],
      outputs: [out],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, {
          name: "captureEmit",
          fn: ({ emit }) => {
            savedEmit = emit;
          },
        });
        m.on(idle, go, () => ({ state: running }));
        m.on(running, stop, () => ({ state: idle }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(go.create());
    actor.send(stop.create());
    savedEmit?.(out.create());
    expect(received).toEqual([]);
  });
});

describe("Subscribers", () => {
  test("done unsubscribe removes the callback", () => {
    const subs = new Subscribers();
    let calls = 0;
    const off = subs.addDone(() => calls++);
    subs.emitDone();
    off();
    subs.emitDone();
    expect(calls).toBe(1);
  });
});

describe("on('error') death signal", () => {
  test("construction-time unhandled death is seeded to a late error subscriber", () => {
    const idle = state("idle")();
    const probe = event("PROBE")();
    const actor = new Actor({
      inputs: [],
      outputs: [probe],
      internal: [probe],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.effect(idle, { name: "emitProbe", fn: ({ emit }) => emit(probe.create()) });
      },
    });
    expect(actor.snapshot().path[0]).toBe("__error");
    const seen: string[] = [];
    const off = actor.on("error", (info) => seen.push(info.reason));
    expect(seen).toEqual(["unhandled"]);
    off();
  });

  test("runtime death fires error subscribers exactly once and recover stops stale seeds", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
      },
    });
    let errors = 0;
    actor.on("error", () => errors++);
    expect(() => actor.send(go.create())).not.toThrow();
    expect(errors).toBe(1);
    actor.recover({ state: idle, context: {} });
    const late: string[] = [];
    actor.on("error", (info) => late.push(info.reason));
    expect(late).toEqual([]);
  });

  test("a throwing error subscriber does not break the death sequence", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
      },
    });
    const seen: string[] = [];
    actor.on("error", () => {
      throw new Error("sub boom");
    });
    actor.on("error", (info) => seen.push(info.reason));
    expect(() => actor.send(go.create())).not.toThrow();
    expect(seen).toEqual(["transition"]);
  });
});

describe("Actor", () => {
  test("regions and options getters expose internals", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(actor.regions).toEqual({});
    expect(actor.options.transitions).toBeDefined();
  });

  test("no initial-state warning when the state is declared", () => {
    const idle = state("idle")();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    } finally {
      console.warn = original;
    }
    expect(warns).toEqual([]);
  });

  test("change subscribers receive the snapshot immediately and can unsubscribe", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let calls = 0;
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    const off = actor.on("change", () => calls++);
    expect(calls).toBe(1);
    off();
    actor.send(go.create());
    expect(calls).toBe(1);
  });

  test("done subscribers can unsubscribe", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let doneCalls = 0;
    const actor = new Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, finish, () => ({ state: done }));
      },
    });
    const off = actor.on("done", () => doneCalls++);
    off();
    actor.send(finish.create());
    expect(doneCalls).toBe(0);
  });

  test("settled returns a promise", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(actor.settled()).toBeInstanceOf(Promise);
  });

  test("region child registration failure is silent", () => {
    const idle = state("idle")();
    const childIdle = state("cidle")();
    const child = new Actor({
      inputs: [],
      states: [childIdle],
      initial: childIdle,
      setup: () => {},
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(String(args[0]));
    try {
      const parent = new Actor({
        inputs: [],
        states: [idle],
        initial: idle,
        regions: { child },
        setup: () => {},
      });
      expect(parent.snapshot().regions.child.path[0]).toBe("cidle");
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });

  test("any handler transition applies when the state handler only emits", () => {
    const idle = state("idle")();
    const active = state("active")();
    const tick = event("TICK")();
    const out = event("OUT")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, tick, () => ({ emit: [out.create()] }));
        m.onAny(tick, () => ({ state: active }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(received).toEqual(["OUT"]);
  });

  test("any handler receives context and actor options", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    let gotContext: number | undefined;
    let gotActor: unknown;
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { n: 5 },
      setup: (m) => {
        m.onAny(tick, (_e, { context, actor: a }) => {
          gotContext = context.get().n;
          gotActor = a;
          return {};
        });
      },
    });
    actor.send(tick.create());
    expect(gotContext).toBe(5);
    expect(gotActor).toBe(actor);
  });

  test("no transition warning when a state handler applies", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(go.create());
    } finally {
      console.warn = original;
    }
    expect(actor.snapshot().path[0]).toBe("active");
    expect(warns).toEqual([]);
  });

  test("no budget warning when draining completes within budget", () => {
    const idle = state("idle")();
    const active = state("active")();
    const out = event("OUT")();
    const go = event("GO")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [go],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active, emit: [out.create()] }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(go.create());
    } finally {
      console.warn = original;
    }
    expect(received).toEqual(["OUT"]);
    expect(warns).toEqual([]);
  });

  test("draining resets between sends", () => {
    const idle = state("idle")();
    const active = state("active")();
    const out = event("OUT")();
    const go = event("GO")();
    const stop = event("STOP")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [go, stop],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active, emit: [out.create()] }));
        m.on(active, stop, () => ({ state: idle, emit: [out.create()] }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(go.create());
    actor.send(stop.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT", "OUT"]);
  });

  test("effect emit routes events through the queue", () => {
    const init = state("init")();
    const idle = state("idle")();
    const done = state("done")();
    const start = event("START")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [start],
      internal: [tick],
      states: [init, idle, done],
      initial: init,
      setup: (m) => {
        m.effect(idle, {
          name: "emitTick",
          fn: ({ emit }) => {
            emit(tick.create());
          },
        });
        m.on(init, start, () => ({ state: idle }));
        m.on(idle, tick, () => ({ state: done }));
      },
    });
    actor.send(start.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("done event only fires when reaching a final state", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let doneCalls = 0;
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    actor.on("done", () => doneCalls++);
    actor.send(go.create());
    expect(doneCalls).toBe(0);
  });

  test("an any handler can transition when no state handler exists", () => {
    const idle = state("idle")();
    const active = state("active")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny(tick, () => ({ state: active }));
      },
    });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("dispose() aborts the running effect", () => {
    const idle = state("idle")();
    const running = state("running")();
    const start = event("START")();
    let effectSignal: AbortSignal | undefined;
    const actor = new Actor({
      inputs: [start],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.on(idle, start, () => ({ state: running }));
        m.effect(running, {
          name: "captureSignal",
          fn: ({ signal }) => {
            effectSignal = signal;
          },
        });
      },
    });
    actor.send(start.create());
    expect(effectSignal?.aborted).toBe(false);
    actor.dispose();
    expect(effectSignal?.aborted).toBe(true);
  });
});

describe("Actor directed mutation tests", () => {
  test("context getter exposes the actor context", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      context: { n: 5 },
      setup: () => {},
    });
    expect(actor.context).toEqual({ n: 5 });
  });

  test("internalBudget of zero triggers the error state on the first event", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = new Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 0,
      setup: (m) => {
        m.on(idle, start, () => ({ emit: [loop.create()] }));
        m.on(idle, loop, () => ({ emit: [loop.create()] }));
      },
    });
    actor.send(start.create());
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("initial state not declared throws", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    expect(
      () =>
        new Actor({
          inputs: [],
          states: [a, b] as AnyStateRef[],
          initial: stray as never,
          setup: () => {},
        }),
    ).toThrow(/stray/);
  });

  test("a region child that ignores output subscriptions still snapshots", () => {
    const idle = state("idle")();
    const stub: AnyActor = {
      state: state("s")(),
      clock: new VirtualClock(),
      regions: {},
      send: () => {},
      inject: () => {},
      dispose: () => {},
      snapshot: () => ({ path: ["s"], context: {}, regions: {} }),
      on: () => () => {},
      recover: () => {},
      settled: async () => {},
    };
    const parent = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      regions: { child: stub },
      setup: () => {},
    });
    expect(parent.snapshot().regions.child.path[0]).toBe("s");
  });

  test("an internal event emitted with no handler routes to the error state", () => {
    const idle = state("idle")();
    const boom = event("BOOM")();
    const actor = new Actor({
      inputs: [],
      internal: [boom],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.inject(boom.create());
    expect(actor.snapshot().path[0]).toBe("__error");
    expect(actor.snapshot().error?.reason).toBe("unhandled");
    expect(actor.snapshot().error?.event.type).toBe("BOOM");
  });

  test("an unhandled external event is ignored without dying", () => {
    const idle = state("idle")();
    const stray = event("STRAY")();
    const actor = new Actor({
      inputs: [stray],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.send(stray.create());
    expect(actor.state.name).toBe("idle");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("dispose() on an actor with no running effect does not throw", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(() => actor.dispose()).not.toThrow();
  });

  test("transition to a state with no effects leaves the effect abort null", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(() => actor.dispose()).not.toThrow();
  });

  test("a change subscriber re-sending events drains without reentrancy errors", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const back = event("BACK")();
    const actor = new Actor({
      inputs: [go, back],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.on(active, back, () => ({ state: idle }));
      },
    });
    actor.on("change", (snap) => {
      if (snap.path[0] === "active") actor.send(back.create());
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("idle");
  });

  test("internalBudget of one stops the second event of a loop", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    let handlerCalls = 0;
    const actor = new Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 1,
      setup: (m) => {
        m.on(idle, start, () => ({ emit: [loop.create()] }));
        m.on(idle, loop, () => {
          handlerCalls++;
          return { emit: [loop.create()] };
        });
      },
    });
    actor.send(start.create());
    expect(handlerCalls).toBe(1);
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("output routing to the handler happens for unlisted event ids", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const go = event("GO")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [go],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ emit: [out.create()] }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(go.create());
    expect(received).toEqual(["OUT"]);
  });
});

describe("Actor directed mutation tests 2", () => {
  test("send is ignored once the actor is final", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    const stray = event("STRAY")();
    let strayRuns = 0;
    const actor = new Actor({
      inputs: [finish, stray],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, finish, () => ({ state: done }));
        m.onAny(stray, () => {
          strayRuns++;
          return {};
        });
      },
    });
    actor.send(finish.create());
    actor.send(stray.create());
    expect(strayRuns).toBe(0);
  });

  test("initial state not declared throws and lists both declared states", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    expect(
      () =>
        new Actor({
          inputs: [],
          states: [a, b] as AnyStateRef[],
          initial: stray as never,
          setup: () => {},
        }),
    ).toThrow(/stray/);
    expect(
      () =>
        new Actor({
          inputs: [],
          states: [a, b] as AnyStateRef[],
          initial: stray as never,
          setup: () => {},
        }),
    ).toThrow(/a, b/);
  });

  test("region child output routes to the parent queue and drains", () => {
    const childIdle = state("cidle")();
    const childDone = state("cdone")();
    const childGo = event("CGO")();
    const doneEvt = event("CHILD_DONE")();
    const parentIdle = state("pidle")();
    const parentActive = state("pactive")();

    const child = new Actor({
      inputs: [childGo],
      outputs: [doneEvt],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, childGo, () => ({ state: childDone, emit: [doneEvt.create()] }));
      },
    });

    const parent = new Actor({
      inputs: [doneEvt],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, doneEvt, () => ({ state: parentActive }));
      },
    });

    child.send(childGo.create());
    expect(parent.snapshot().path[0]).toBe("pactive");
    expect(parent.snapshot().regions.child.path[0]).toBe("cdone");
  });

  test("an any handler can emit without transitioning", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const out = event("OUT")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny(tick, () => ({ emit: [out.create()] }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT"]);
  });

  test("a state handler transition blocks an any handler transition for the same event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const tick = event("TICK")();
    let anyRuns = 0;
    const actor = new Actor({
      inputs: [tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, tick, () => ({ state: active }));
        m.onAny(tick, () => {
          anyRuns++;
          return { state: idle };
        });
      },
    });
    actor.send(tick.create());
    expect(anyRuns).toBe(1);
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("done fires exactly once when reaching a final state", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let doneCalls = 0;
    const actor = new Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, finish, () => ({ state: done }));
      },
    });
    actor.on("done", () => doneCalls++);
    actor.send(finish.create());
    expect(doneCalls).toBe(1);
  });

  test("an effect emitting an input event dispatches through the input id set", () => {
    const clock = new VirtualClock();
    const init = state("init")();
    const done = state("done")();
    const start = event("START")();
    const tick = event("TICK")();
    const actor = new Actor({
      clock,
      inputs: [start, tick],
      internal: [],
      states: [init, done],
      initial: init,
      setup: (m) => {
        m.on(init, start, () => ({ state: init }));
        m.effect(init, {
          name: "emitTick",
          fn: ({ emit }) => {
            emit(tick.create());
          },
        });
        m.on(init, tick, () => ({ state: done }));
      },
    });
    actor.send(start.create());
    clock.advance(1);
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("a state handler receives the actor in its options", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let gotActor: unknown;
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, (_e, { actor: a }) => {
          gotActor = a;
          return { state: active };
        });
      },
    });
    actor.send(go.create());
    expect(gotActor).toBe(actor);
    expect(actor.snapshot().path[0]).toBe("active");
  });
});

describe("Actor error state directed mutation tests", () => {
  test("a throwing handler cannot escape send", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("transition");
  });

  test("death is terminal — later sends never resurrect the machine", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const bad = event("BAD")();
    let handlerCalls = 0;
    const actor = new Actor({
      inputs: [go, bad],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.onAny(bad, () => {
          throw new Error("boom");
        });
        m.on(active, go, () => {
          handlerCalls++;
          return { state: idle };
        });
      },
    });
    actor.send(bad.create());
    actor.send(go.create());
    expect(handlerCalls).toBe(0);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a throwing subscriber leaves the machine running", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    actor.on("change", () => {
      throw new Error("boom");
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().path[0]).toBe("active");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("budget exhaustion routes to the error state, not a bare halt", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = new Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 1,
      setup: (m) => {
        m.on(idle, start, () => ({ emit: [loop.create()] }));
        m.on(idle, loop, () => ({ emit: [loop.create()] }));
      },
    });
    expect(() => actor.send(start.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("budget");
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a throwing entry effect kills the machine and skips later effects", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const seen: string[] = [];
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "failFirst",
          fn: () => {
            seen.push("first");
            throw new Error("boom");
          },
        });
        m.effect(loading, {
          name: "recordSecond",
          fn: () => {
            seen.push("second");
          },
        });
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(seen).toEqual(["first"]);
    expect(actor.snapshot().error?.reason).toBe("effect");
  });

  test("a throwing output handler kills the machine", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ emit: [out.create()] }));
      },
    });
    actor.on("output", () => {
      throw new Error("output boom");
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("output");
  });

  test("the first error wins — a later throw does not replace it", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const bad = event("BAD")();
    const actor = new Actor({
      inputs: [go, bad],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny(go, () => {
          throw new Error("first");
        });
        m.onAny(bad, () => {
          throw new Error("second");
        });
      },
    });
    actor.send(go.create());
    actor.send(bad.create());
    const snap = actor.snapshot();
    expect(snap.error?.event.type).toBe("GO");
    expect(snap.error?.error instanceof Error).toBe(true);
    if (snap.error) {
      expect((snap.error.error as Error).message).toBe("first");
    }
  });

  test("death emits exactly one change and one done", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let changes = 0;
    let dones = 0;
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.effect(active, {
          name: "throwOnEnter",
          fn: () => {
            throw new Error("boom");
          },
        });
      },
    });
    actor.on("change", () => changes++);
    actor.on("done", () => dones++);
    changes = 0;
    actor.send(go.create());
    expect(changes).toBe(1);
    expect(dones).toBe(1);
  });

  test("an async rejection kills the machine once the run settles", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "rejectAsync",
          fn: async () => {
            throw new Error("late boom");
          },
        });
      },
    });
    actor.send(go.create());
    await actor.settled();
    expect(actor.snapshot().path[0]).toBe("__error");
    expect(actor.snapshot().error?.reason).toBe("effect");
  });

  test("an any transition cannot resurrect a dead machine", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const bad = event("BAD")();
    let anyCalls = 0;
    const actor = new Actor({
      inputs: [go, bad],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny(go, () => {
          anyCalls++;
          return { state: active };
        });
        m.onAny(bad, () => {
          throw new Error("boom");
        });
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(anyCalls).toBe(1);
    expect(actor.snapshot().path[0]).toBe("active");
    actor.send(bad.create());
    expect(actor.snapshot().path[0]).toBe("__error");
    actor.send(go.create());
    expect(anyCalls).toBe(1);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("the first error wins across reentrant drains", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const boom = event("BOOM")();
    const actor = new Actor({
      inputs: [go],
      outputs: [boom],
      internal: [boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.on(loading, boom, () => {
          throw new Error("nested");
        });
        m.effect(loading, {
          name: "emitBoomThenThrow",
          fn: ({ emit }) => {
            emit(boom.create());
            throw new Error("outer");
          },
        });
      },
    });
    actor.send(go.create());
    const snap = actor.snapshot();
    expect(snap.error?.reason).toBe("transition");
    expect(snap.error?.event.type).toBe("BOOM");
  });

  test("a falsy thrown value still kills the machine", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw 0;
        });
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("transition");
  });

  test("an invalid transition target kills the machine", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: { state: "garbage" } }) as never);
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("transition");
    expect(actor.snapshot().error?.state.name).toBe("idle");
  });

  test("an Any handler does not run after the state handler dies", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let ranAny = false;
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
        m.onAny(go, () => {
          ranAny = true;
          return { state: active };
        });
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(ranAny).toBe(false);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a successful output handler does not stop the drain", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const go = event("GO")();
    const received: string[] = [];
    const actor = new Actor({
      inputs: [go],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ emit: [out.create(), out.create()] }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(go.create());
    expect(received).toEqual(["OUT", "OUT"]);
  });

  test("no spurious change after a change already consumed a context write", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const ping = event("PING")();
    let changes = 0;
    const actor = new Actor({
      inputs: [go, ping],
      states: [idle],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, go, (_e, { context }) => {
          context.set({ n: 1 });
          return {};
        });
        m.on(idle, ping, () => ({}));
      },
    });
    actor.on("change", () => changes++);
    changes = 0;
    actor.send(go.create());
    actor.send(ping.create());
    expect(changes).toBe(1);
  });

  test("the invalid target error message is deterministic", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: { state: "garbage" } }) as never);
      },
    });
    actor.send(go.create());
    const msg = actor.snapshot().error?.error;
    expect(msg instanceof Error && msg.message).toBe("invalid transition target");
  });

  test("a throw during a drain drops the remaining queued events", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const boom = event("BOOM")();
    let boomCalls = 0;
    const actor = new Actor({
      inputs: [go],
      outputs: [boom],
      internal: [boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading, emit: [boom.create(), boom.create()] }));
        m.on(loading, boom, () => {
          boomCalls++;
          throw new Error("boom");
        });
      },
    });
    actor.send(go.create());
    expect(boomCalls).toBe(1);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a resolving async effect does not kill the machine", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    let settled = false;
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "settleAfterMicrotasks",
          fn: async () => {
            await Promise.resolve();
            settled = true;
          },
        });
      },
    });
    actor.send(go.create());
    await actor.settled();
    expect(settled).toBe(true);
    expect(actor.snapshot().path[0]).toBe("loading");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("settled waits for a delayed async rejection", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "rejectDelayed",
          fn: async () => {
            await Promise.resolve();
            await Promise.resolve();
            throw new Error("delayed boom");
          },
        });
      },
    });
    actor.send(go.create());
    await actor.settled();
    const delayedSnap = actor.snapshot();
    expect(delayedSnap.error?.reason).toBe("effect");
    expect(delayedSnap.error?.error instanceof Error).toBe(true);
    if (delayedSnap.error) {
      expect((delayedSnap.error.error as Error).message).toBe("delayed boom");
    }
  });

  test("an output with no handler is dropped and the machine survives", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ emit: [out.create()] }));
      },
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("the error field is absent while the machine is healthy", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    expect("error" in actor.snapshot()).toBe(false);
  });

  test("an output throw outside a dispatch records the current state", () => {
    const clock = new VirtualClock();
    const idle = state("idle")();
    const out = event("OUT")();
    const actor = new Actor({
      clock,
      inputs: [],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("output", () => {
      throw new Error("boom");
    });
    actor.inject(out.create());
    expect(actor.snapshot().error?.reason).toBe("output");
    expect(actor.snapshot().error?.state.name).toBe("idle");
  });

  test("the budget error carries the deterministic message", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = new Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 0,
      setup: (m) => {
        m.on(idle, start, () => ({ emit: [loop.create()] }));
      },
    });
    actor.send(start.create());
    const budgetSnap = actor.snapshot();
    expect(budgetSnap.error?.reason).toBe("budget");
    expect(budgetSnap.error?.error instanceof Error).toBe(true);
    if (budgetSnap.error) {
      expect((budgetSnap.error.error as Error).message).toBe("internal event budget exceeded");
    }
  });

  test("an effect death records the state being entered", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => {
            throw new Error("boom");
          },
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().error?.state.name).toBe("loading");
    expect(actor.snapshot().error?.context).toEqual({});
  });

  test("a payload-less event reaching a payload-reading handler gets an empty payload", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    const actor = new Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, update, (e) => {
          void e.payload.codeSize;
          return {};
        });
      },
    });
    (actor as AnyActor).send({ type: "UPDATE" });
    expect(actor.snapshot().error).toBeUndefined();
    expect(actor.state.name).toBe("idle");
  });

  test("transition hook fires for handled events and reports transitioned", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", (info) =>
      seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    );
    actor.send(go.create());
    expect(seen).toHaveLength(1);
    expect(seen[0].from).toBe("idle");
    expect(seen[0].to).toBe("active");
    expect(seen[0].transitioned).toBe(true);
  });

  test("transition info carries the exact names of effects that ran on entry", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.effect(active, { name: "markReady", fn: () => {} });
        m.effect(active, { name: "logEntry", fn: () => {} });
      },
    });
    const seen: Array<{ to: string; effects: string[] }> = [];
    actor.on("transition", (info) => seen.push({ to: info.to, effects: [...info.effects] }));
    actor.send(go.create());
    expect(seen).toHaveLength(1);
    expect(seen[0].effects).toEqual(["markReady", "logEntry"]);
  });

  test("transition into a state without effects reports an empty effects list", () => {
    const idle = state("idle")();
    const bare = state("bare")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, bare],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: bare }));
      },
    });
    const seen: Array<string[]> = [];
    actor.on("transition", (info) => seen.push([...info.effects]));
    actor.send(go.create());
    expect(seen).toEqual([[]]);
  });

  test("a handled no-op event reports an empty effects list", () => {
    const idle = state("idle")();
    const ping = event("PING")();
    const actor = new Actor({
      inputs: [ping],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, ping, () => ({}));
      },
    });
    const seen: Array<string[]> = [];
    actor.on("transition", (info) => seen.push([...info.effects]));
    actor.send(ping.create());
    expect(seen).toEqual([[]]);
  });

  test("transition hook does not fire for dropped events", () => {
    const idle = state("idle")();
    const stray = event("STRAY")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    let fires = 0;
    actor.on("transition", () => fires++);
    (actor as AnyActor).send(stray.create());
    expect(fires).toBe(0);
  });

  test("transition hook does not fire once the machine is dead", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
      },
    });
    let fires = 0;
    actor.on("transition", () => fires++);
    actor.send(go.create());
    expect(actor.snapshot().error?.reason).toBe("transition");
    expect(fires).toBe(0);
  });

  test("transition hook does not fire when a transition's effect throws", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => {
            throw new Error("effect boom");
          },
        });
      },
    });
    let fires = 0;
    actor.on("transition", () => fires++);
    actor.send(go.create());
    expect(actor.snapshot().error?.reason).toBe("effect");
    expect(fires).toBe(0);
  });

  test("a throwing transition subscriber is contained and the machine survives", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: idle }));
      },
    });
    actor.on("transition", () => {
      throw new Error("sub boom");
    });
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("recover restores a dead machine to the caller-supplied state and context", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const tick = event("TICK")();
    let ticks = 0;
    const actor = new Actor({
      inputs: [go, tick],
      states: [idle, loading],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => {
            throw new Error("effect boom");
          },
        });
        m.on(loading, tick, () => {
          ticks++;
          return { state: idle };
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().error?.reason).toBe("effect");
    actor.recover({ state: loading, context: { n: 7 } });
    expect(actor.snapshot().error).toBeUndefined();
    expect(actor.snapshot().path[0]).toBe("loading");
    expect(actor.context).toEqual({ n: 7 });
    actor.send(tick.create());
    expect(ticks).toBe(1);
  });

  test("recover is a no-op when the machine is not dead", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      context: { n: 1 },
      setup: (m) => {
        m.on(idle, go, () => ({ state: idle }));
      },
    });
    let changes = 0;
    actor.on("change", () => changes++);
    changes = 0;
    actor.recover({ state: idle, context: { n: 99 } });
    expect(changes).toBe(0);
    expect(actor.context).toEqual({ n: 1 });
  });

  test("done subscribers receive the done callback", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    const actor = new Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, finish, () => ({ state: done }));
      },
    });
    let dones = 0;
    actor.on("done", () => dones++);
    actor.send(finish.create());
    expect(actor.snapshot().done).toBe(true);
    expect(dones).toBe(1);
  });

  test("snapshot exposes the payload of the current state", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: ready, payload: { items: ["a"] } }));
      },
    });
    expect(actor.snapshot().payload).toBeUndefined();
    actor.send(go.create());
    expect(actor.snapshot().payload).toEqual({ items: ["a"] });
  });

  test("snapshot payload is cleared once the machine dies", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: ready, payload: { items: ["a"] } }));
        m.effect(ready, {
          name: "throwOnEnter",
          fn: () => {
            throw new Error("boom");
          },
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("__error");
    expect(actor.snapshot().payload).toBeUndefined();
  });

  test("an undeclared-internal actor routes unknown-typed events to the output handler", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const actor = new Actor({
      inputs: [],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const received: Array<{ type?: string }> = [];
    actor.on("output", (e) => received.push(e));
    actor.inject({ type: undefined } as unknown as InternalEvent);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBeUndefined();
  });
});

describe("dispose and inject directed mutation tests", () => {
  test("dispose makes send and inject no-ops", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const boom = event("BOOM")();
    const actor = new Actor({
      inputs: [go],
      internal: [boom],
      states: [idle, active],
      initial: idle,
      setup: (m) => m.on(idle, go, () => ({ state: active })),
    });
    actor.dispose();
    actor.send(go.create());
    expect(actor.state.name).toBe("idle");
    actor.inject(boom.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("dispose inside a transition drops later emits and skips effects", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const boom = event("BOOM")();
    let effectRan = false;
    const actor = new Actor({
      inputs: [go],
      outputs: [boom],
      internal: [boom],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, (_e, opts) => {
          opts.actor.dispose();
          return { state: active, emit: [boom.create()] };
        });
        m.effect(active, {
          name: "markEffectRan",
          fn: () => {
            effectRan = true;
          },
        });
      },
    });
    actor.send(go.create());
    expect(actor.state.name).toBe("active");
    expect(actor.snapshot().error).toBeUndefined();
    expect(effectRan).toBe(false);
  });

  test("an unhandled internal event reports the exact message", () => {
    const idle = state("idle")();
    const boom = event("BOOM")();
    const actor = new Actor({
      inputs: [],
      internal: [boom],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.inject(boom.create());
    expect(actor.snapshot().error?.error).toEqual(
      new Error('[Actor] internal event "BOOM" emitted but no handler in state "idle"'),
    );
  });

  test("an unhandled external send does not emit a change", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      setup: (m) => m.onAny(tick, () => ({})),
    });
    let changes = 0;
    actor.on("change", () => changes++);
    expect(changes).toBe(1);
    actor.send(tick.create());
    expect(changes).toBe(1);
  });

  test("recover resets the change signal so a later no-op send stays silent", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [go, tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("__error");
    actor.recover({ state: idle, context: {} });
    let changes = 0;
    actor.on("change", () => changes++);
    expect(changes).toBe(1);
    actor.send(tick.create());
    expect(changes).toBe(1);
  });

  test("snapshots without payloads omit the payload key", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect("payload" in actor.snapshot()).toBe(false);
  });
});

describe("ActorBuilder registration invariants", () => {
  test("a single valid on() registers and dispatches", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("two distinct events on the same state both register", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const stop = event("STOP")();
    const actor = new Actor({
      inputs: [go, stop],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.on(active, stop, () => ({ state: idle }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("active");
    actor.send(stop.create());
    expect(actor.snapshot().path[0]).toBe("idle");
  });

  test("a later on(state, event) overrides the earlier handler", () => {
    const idle = state("idle")();
    const active = state("active")();
    const done = state("done")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.on(idle, go, () => ({ state: done }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("a single valid onAny() registers and dispatches", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [go, tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny(tick, () => ({ state: active }));
      },
    });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("a later onAny(event) overrides the earlier handler", () => {
    const idle = state("idle")();
    const active = state("active")();
    const done = state("done")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.onAny(go, () => ({ state: active }));
        m.onAny(go, () => ({ state: done }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });
});
