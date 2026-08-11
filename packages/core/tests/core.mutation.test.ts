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
import {
  registerActor,
  getChildren,
  getOutputHandler,
  setOutputHandler,
  pushInternal,
  drainInternal,
  abortEffects,
} from "../src/internal-registry.ts";
import type { ActorInternal } from "../src/internal-registry.ts";
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
  test("isProcessing is true during processing and false after", () => {
    const queue = new InternalQueue();
    const seen: Array<boolean | undefined> = [];
    queue.push({ type: "A" });
    queue.process(() => seen.push(queue.isProcessing));
    seen.push(queue.isProcessing);
    expect(seen).toEqual([true, false]);
  });

  test("length is the remaining count while processing", () => {
    const queue = new InternalQueue();
    const lens: number[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.process(() => lens.push(queue.length));
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
    queue.process(() => {});
    await p;
  });

  test("a cancelled process does not leak stopped state", () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    queue.processCancellable(() => false);
    queue.push({ type: "B" });
    expect(queue.length).toBe(1);
    queue.process(() => {});
    expect(queue.length).toBe(0);
  });

  test("nested process calls are ignored while processing", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" });
    queue.process((e) => {
      if (e.type === "A") {
        queue.process((inner) => seen.push(`inner:${inner.type}`));
      } else {
        seen.push(`outer:${e.type}`);
      }
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
  test("does not run effects for final states even when declared", () => {
    const seen: string[] = [];
    const result = runEffects({
      effects: { done: [() => seen.push("ran")] },
      state: state("done")().final(),
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
    });
    expect(result).toBeNull();
    expect(seen).toEqual([]);
  });

  test("returns null for an empty effect list", () => {
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
    });
    expect(result).toBeNull();
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

describe("internal-registry", () => {
  test("registry helpers operate on registered actors", () => {
    const children = new Map<string, never>();
    let handler: ((event: InternalEvent) => void) | null = null;
    const pushed: InternalEvent[] = [];
    let drained = 0;
    let aborted = 0;
    const internal: ActorInternal = {
      children,
      getOutputHandler: () => handler,
      setOutputHandler: (fn) => {
        handler = fn;
      },
      pushInternal: (e) => {
        pushed.push(e);
      },
      drainInternal: () => {
        drained++;
      },
      abortEffects: () => {
        aborted++;
      },
    };
    const actor = {};
    registerActor(actor, internal);
    expect(getChildren(actor)[1]).toBe(children);
    const fn = () => {};
    setOutputHandler(actor, fn);
    expect(getOutputHandler(actor)[1]).toBe(fn);
    pushInternal(actor, { type: "P" });
    expect(pushed).toEqual([{ type: "P" }]);
    drainInternal(actor);
    expect(drained).toBe(1);
    abortEffects(actor);
    expect(aborted).toBe(1);
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
    setOutputHandler(actor, (e) => received.push(e.type));
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
    setOutputHandler(actor, (e) => received.push(e.type));
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
    setOutputHandler(actor, (e) => received.push(e.type));
    actor.send(go.create());
    actor.send(stop.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT", "OUT"]);
  });

  test("pushInternal and clock advance drain the queue", () => {
    const clock = new VirtualClock();
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      clock,
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    pushInternal(actor, go.create());
    expect(actor.state.name).toBe("idle");
    clock.advance(1);
    expect(actor.state.name).toBe("active");
  });

  test("pushInternal and drainInternal process queued events", () => {
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
    pushInternal(actor, go.create());
    drainInternal(actor);
    expect(actor.state.name).toBe("active");
  });

  test("getOutputHandler returns the registered handler", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    const fn = () => {};
    setOutputHandler(actor, fn);
    expect(getOutputHandler(actor)[1]).toBe(fn);
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
        m.effect(idle, ({ emit }) => {
          emit(tick.create());
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

  test("abortEffects via the registry aborts the running effect", () => {
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
        m.effect(running, ({ signal }) => {
          effectSignal = signal;
        });
      },
    });
    actor.send(start.create());
    expect(effectSignal?.aborted).toBe(false);
    abortEffects(actor);
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

  test("internalBudget of zero triggers the budget warning on the first event", () => {
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
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(start.create());
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => w.includes("budget"))).toBe(true);
  });

  test("initial state warning fires when the state is not declared", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      new Actor({
        inputs: [],
        states: [a, b] as AnyStateRef[],
        initial: stray as never,
        setup: () => {},
      });
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => w.includes("stray"))).toBe(true);
  });

  test("unregistered region child logs a registry error", () => {
    const idle = state("idle")();
    const stub: AnyActor = {
      state: state("s")(),
      clock: new VirtualClock(),
      regions: {},
      send: () => {},
      snapshot: () => ({ path: ["s"], context: {}, regions: {} }),
      on: () => () => {},
      settled: async () => {},
    };
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(String(args[0]));
    try {
      new Actor({
        inputs: [],
        states: [idle],
        initial: idle,
        regions: { child: stub },
        setup: () => {},
      });
    } finally {
      console.error = original;
    }
    expect(errors.some((e) => e.includes("not registered"))).toBe(true);
  });

  test("no-transition warning fires for an unhandled event", () => {
    const idle = state("idle")();
    const stray = event("STRAY")();
    const actor = new Actor({
      inputs: [stray],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(stray.create());
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => w.includes("no transition"))).toBe(true);
  });

  test("abortEffects on an actor with no running effect does not throw", () => {
    const idle = state("idle")();
    const actor = new Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(() => abortEffects(actor)).not.toThrow();
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
    expect(() => abortEffects(actor)).not.toThrow();
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
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(start.create());
    } finally {
      console.warn = original;
    }
    expect(handlerCalls).toBe(1);
    expect(warns.some((w) => w.includes("budget"))).toBe(true);
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
    setOutputHandler(actor, (e) => received.push(e.type));
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

  test("initial state warning lists both declared states", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      new Actor({
        inputs: [],
        states: [a, b] as AnyStateRef[],
        initial: stray as never,
        setup: () => {},
      });
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => w.includes("stray"))).toBe(true);
    expect(warns.some((w) => w.includes("a, b"))).toBe(true);
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
    setOutputHandler(actor, (e) => received.push(e.type));
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
        m.effect(init, ({ emit }) => {
          emit(tick.create());
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
