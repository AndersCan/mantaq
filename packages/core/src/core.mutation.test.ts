import { trackAbort } from "./abort-tracker.ts";
import type { AnyActor } from "./actor-internal.ts";
import { Actor } from "./actor.ts";
import { Context } from "./context.ts";
import { runEffects } from "./effects.ts";
import { event } from "./event.ts";
import type { InternalEvent } from "./index.ts";
import { InternalQueue } from "./queue.ts";
import { RealClock } from "./real-clock.ts";
import { state } from "./state.ts";
import type { AnyStateRef, StateRef } from "./state.ts";
import { Subscribers } from "./subscribers.ts";
import { VirtualClock } from "./virtual-clock.ts";
import { expect, test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 */
function isErrorBomb(message: string): never {
  throw new Error(message);
}

function isFalsyBomb(): never {
  throw 0;
}

function errorMessage(failure: unknown): string {
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    const message = failure.message;
    if (typeof message === "string") return message;
  }
  return String(failure);
}

/**
 * Runtime-invalid state ref: structurally a StateRef but never registered, so
 * isStateRef() rejects it. Used to force the invalid-transition-target guard.
 */
const impostorFinal: StateRef<string, unknown, true> = {
  name: "garbage",
  isFinal: true,
  regions: () => impostorFinal,
  final: () => impostorFinal,
  create: (payload) => ({ state: impostorFinal, payload }),
};
const impostor: StateRef<string, unknown, false> = {
  name: "garbage",
  isFinal: false,
  regions: () => impostor,
  final: () => impostorFinal,
  create: (payload) => ({ state: impostor, payload }),
};
const impostorState: StateRef<string, unknown, false> = {
  name: "garbage",
  isFinal: false,
  regions: () => impostor,
  final: () => impostorFinal,
  create: (payload) => ({ state: impostor, payload }),
};

describe("VirtualClock", () => {
  test("timer ids increase across calls", () => {
    const clock = VirtualClock();
    const a = clock.setTimeout(10, { cb: () => {} });
    const b = clock.setTimeout(20, { cb: () => {} });
    expect(a).toBe(1);
    expect(b).toBe(2);
    const c = clock.setInterval(10, { cb: () => {} });
    const firstInterval = clock.setInterval(20, { cb: () => {} });
    expect(c).toBe(3);
    expect(firstInterval).toBe(4);
  });

  test("timers call their callbacks in deadline order", () => {
    const clock = VirtualClock();
    const order: number[] = [];
    clock.setTimeout(10, { cb: () => order.push(1) });
    clock.setTimeout(20, { cb: () => order.push(2) });
    clock.advance(30);
    expect(order).toEqual([1, 2]);
  });

  test("intervals call their callbacks in next-deadline order", () => {
    const clock = VirtualClock();
    const order: number[] = [];
    clock.setInterval(10, { cb: () => order.push(1) });
    clock.setInterval(20, { cb: () => order.push(2) });
    clock.advance(30);
    expect(order[0]).toBe(1);
  });

  test("an interval due exactly at the target calls its callback", () => {
    const clock = VirtualClock();
    let count = 0;
    clock.setInterval(20, { cb: () => count++ });
    clock.advance(20);
    expect(count).toBe(1);
  });

  test("an interval skips its callback before its deadline", () => {
    const clock = VirtualClock();
    let fastCount = 0;
    let slowCount = 0;
    clock.setInterval(10, { cb: () => fastCount++ });
    clock.setInterval(30, { cb: () => slowCount++ });
    clock.advance(25);
    expect([fastCount, slowCount]).toEqual([2, 0]);
  });

  test("hasPending returns true with only intervals scheduled", () => {
    const clock = VirtualClock();
    clock.setInterval(10, { cb: () => {} });
    expect(clock.hasPending()).toBe(true);
  });

  test("pendingTimers returns the remaining ms after advance", () => {
    const clock = VirtualClock();
    clock.advance(5);
    clock.setTimeout(30, { eventName: "t", cb: () => {} });
    const pending = clock.pendingTimers();
    expect(pending).toHaveLength(1);
    expect(pending[0].ms).toBe(30);
  });
});

describe("RealClock", () => {
  test("now returns time relative to construction, not epoch time", () => {
    const clock = RealClock();
    expect(clock.now()).toBeLessThan(1000);
  });

  test("setTimeout with options but no signal still sets up the callback", () => {
    const clock = RealClock();
    let fired = false;
    const timerId = clock.setTimeout(5, {
      cb: () => {
        fired = true;
      },
    });
    expect(typeof timerId).toBe("number");
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(true);
        resolve();
      }, 40),
    );
  });

  test("a fired timeout removes its abort listener", async () => {
    const clock = RealClock();
    const controller = new AbortController();
    const calls: unknown[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = (handle) => {
      calls.push(handle);
      return original(handle);
    };
    try {
      let fired = false;
      const timerId = clock.setTimeout(5, {
        signal: controller.signal,
        cb: () => {
          fired = true;
        },
      });
      const deadline = Date.now() + 100;
      while (!fired && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(fired).toBe(true);
      controller.abort();
      expect(calls.includes(timerId)).toBe(false);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  test("the timeout abort listener calls clearTimeout only once", () => {
    const clock = RealClock();
    const controller = new AbortController();
    const calls: unknown[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = (handle) => {
      calls.push(handle);
      return original(handle);
    };
    try {
      const timerId = clock.setTimeout(50, { signal: controller.signal, cb: () => {} });
      controller.signal.dispatchEvent(new Event("abort"));
      controller.signal.dispatchEvent(new Event("abort"));
      expect(calls.filter((c) => c === timerId)).toHaveLength(1);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  test("the interval abort listener calls clearInterval only once", () => {
    const clock = RealClock();
    const controller = new AbortController();
    const calls: unknown[] = [];
    const original = globalThis.clearInterval;
    globalThis.clearInterval = (handle) => {
      calls.push(handle);
      return original(handle);
    };
    try {
      const timerId = clock.setInterval(1000, { signal: controller.signal, cb: () => {} });
      controller.signal.dispatchEvent(new Event("abort"));
      controller.signal.dispatchEvent(new Event("abort"));
      expect(calls.filter((c) => c === timerId)).toHaveLength(1);
    } finally {
      globalThis.clearInterval = original;
    }
  });
});

describe("InternalQueue", () => {
  test("length returns the remaining count while processing", () => {
    const queue = InternalQueue();
    const lens: number[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable(() => {
      lens.push(queue.length);
      return true;
    });
    expect(lens).toEqual([2, 1, 0]);
  });

  test("settled resolves without a process call when idle", async () => {
    const queue = InternalQueue();
    expect(queue.settled()).toBeInstanceOf(Promise);
    let resolved = false;
    void queue.settled().then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
  });

  test("settled keeps pending while events are queued", async () => {
    const queue = InternalQueue();
    queue.push({ type: "A" });
    let resolved = false;
    const settledPromise = queue.settled();
    void settledPromise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);
    queue.processCancellable(() => true);
    await settledPromise;
  });

  test("a cancelled process keeps the queue usable", () => {
    const queue = InternalQueue();
    queue.push({ type: "A" });
    queue.processCancellable(() => false);
    queue.push({ type: "B" });
    const lengthAfterStop = queue.length;
    queue.processCancellable(() => true);
    expect([lengthAfterStop, queue.length]).toEqual([1, 0]);
  });

  test("nested process calls are ignored while processing", () => {
    const queue = InternalQueue();
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
  test("the trackAbort cleanup calls back only once across repeated abort events", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    const controller = new AbortController();
    trackAbort(controller.signal, { timerId: 1, entries: map });
    controller.signal.dispatchEvent(new Event("abort"));
    map.set(1, { signal: controller.signal });
    controller.signal.dispatchEvent(new Event("abort"));
    expect(map.has(1)).toBe(true);
  });
});

describe("runEffects", () => {
  test("runEffects calls effects for final states when declared", () => {
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
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
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
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: state("idle")(), context: {} },
      onError: () => {},
    });
    expect(result.pending).toEqual([]);
  });
});

describe("Actor state entry directed mutation tests", () => {
  test("the actor calls initial state effects at construction with the synthetic __init event", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    let sawEvent: InternalEvent | undefined;
    const actor = Actor({
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
        m.on(idle, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    expect({
      eventType: sawEvent?.type,
      state: actor.snapshot().path[0],
      done: actor.snapshot().done,
    }).toEqual({
      eventType: "__init",
      state: "done",
      done: true,
    });
  });

  test("the initial state effect sets a timer that completes the machine at the deadline", () => {
    const clock = VirtualClock();
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const actor = Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "armDeadlineTimer",
          fn: ({ clock: c, emit }) => {
            c.setTimeout(100, { cb: () => emit(tick.create()) });
          },
        });
        m.on(idle, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    const statesAt = [actor.snapshot().path[0]];
    clock.advance(99);
    statesAt.push(actor.snapshot().path[0]);
    clock.advance(1);
    statesAt.push(actor.snapshot().path[0]);
    expect(statesAt).toEqual(["idle", "idle", "done"]);
  });

  test("the actor removes settled entries from pendingEffects as async effects settle", async () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: idle }) });
        m.effect(idle, {
          name: "settleAsync",
          fn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        });
      },
    });
    for (let idx = 0; idx < 200; idx++) actor.send(trigger.create());
    await actor.settled();
    expect(actor.pendingEffectCount()).toBe(0);
  });

  test("dispose clears the pending effects set", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: idle }) });
        m.effect(idle, {
          name: "hangAsync",
          fn: () => new Promise<void>(() => {}),
        });
      },
    });
    for (let idx = 0; idx < 50; idx++) actor.send(trigger.create());
    expect(actor.pendingEffectCount()).toBe(51);
    actor.dispose();
    expect(actor.pendingEffectCount()).toBe(0);
  });

  test("emit after the effect aborts is a silent no-op", () => {
    const idle = state("idle")();
    const running = state("running")();
    const trigger = event("GO")();
    const stop = event("STOP")();
    const out = event("OUT")();
    const received: string[] = [];
    let savedEmit: ((e: InternalEvent) => void) | undefined;
    const actor = Actor({
      inputs: [trigger, stop],
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
        m.on(idle, { eventRef: trigger, handler: () => ({ state: running }) });
        m.on(running, { eventRef: stop, handler: () => ({ state: idle }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(trigger.create());
    actor.send(stop.create());
    savedEmit?.(out.create());
    expect(received).toEqual([]);
  });
});

describe("Subscribers", () => {
  test("done unsubscribe removes the callback", () => {
    const subs = Subscribers();
    let calls = 0;
    const off = subs.addDone(() => calls++);
    subs.emitDone();
    off();
    subs.emitDone();
    expect(calls).toBe(1);
  });
});

describe("on('error') death signal", () => {
  test("the actor calls a late error subscriber with a construction-time unhandled death", () => {
    const idle = state("idle")();
    const probe = event("PROBE")();
    const actor = Actor({
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
    const off = actor.on("error", { fn: (info) => seen.push(info.reason) });
    expect(seen).toEqual(["unhandled"]);
    off();
  });

  test("runtime death calls error subscribers exactly once and recover blocks stale seeds", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
      },
    });
    let errors = 0;
    actor.on("error", { fn: () => errors++ });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(errors).toBe(1);
    actor.recover({ state: idle, context: {} });
    const late: string[] = [];
    actor.on("error", { fn: (info) => late.push(info.reason) });
    expect(late).toEqual([]);
  });

  test("a throwing error subscriber does not break the death sequence", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
      },
    });
    const seen: string[] = [];
    actor.on("error", { fn: () => isErrorBomb("sub boom") });
    actor.on("error", { fn: (info) => seen.push(info.reason) });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(seen).toEqual(["transition"]);
  });
});

describe("Actor", () => {
  test("regions and options getters return the internals", () => {
    const idle = state("idle")();
    const actor = Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect({ regions: actor.regions, transitions: actor.options.transitions }).toEqual({
      regions: {},
      transitions: {},
    });
  });

  test("construction skips the warning when the initial state is declared", () => {
    const idle = state("idle")();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    } finally {
      console.warn = original;
    }
    expect(warns).toEqual([]);
  });

  test("the actor calls change subscribers immediately and lets them unsubscribe", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let calls = 0;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const off = actor.on("change", { fn: () => calls++ });
    expect(calls).toBe(1);
    off();
    actor.send(trigger.create());
    expect(calls).toBe(1);
  });

  test("done subscribers can remove themselves via unsubscribe", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let doneCalls = 0;
    const actor = Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
      },
    });
    const off = actor.on("done", { fn: () => doneCalls++ });
    off();
    actor.send(finish.create());
    expect(doneCalls).toBe(0);
  });

  test("settled returns a promise", () => {
    const idle = state("idle")();
    const actor = Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(actor.settled()).toBeInstanceOf(Promise);
  });

  test("the actor ignores region child registration failures", () => {
    const idle = state("idle")();
    const childIdle = state("cidle")();
    const child = Actor({
      inputs: [],
      states: [childIdle],
      initial: childIdle,
      setup: () => {},
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(String(args[0]));
    try {
      const parent = Actor({
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
    const actor = Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: tick, handler: () => ({ emit: [out.create()] }) });
        m.onAny({ eventRef: tick, handler: () => ({ state: active }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(received).toEqual(["OUT"]);
  });

  test("the machine calls any handlers with context and actor options", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    let gotContext: number | undefined;
    let gotActor: unknown;
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { n: 5 },
      setup: (m) => {
        m.onAny({
          eventRef: tick,
          handler: (_e, { context, actor: a }) => {
            gotContext = context.get().n;
            gotActor = a;
            return {};
          },
        });
      },
    });
    actor.send(tick.create());
    expect(gotContext).toBe(5);
    expect(gotActor).toBe(actor);
  });

  test("the machine skips the transition warning when a state handler applies", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(trigger.create());
    } finally {
      console.warn = original;
    }
    expect(actor.snapshot().path[0]).toBe("active");
    expect(warns).toEqual([]);
  });

  test("the machine skips the budget warning when draining completes within budget", () => {
    const idle = state("idle")();
    const active = state("active")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const received: string[] = [];
    const actor = Actor({
      inputs: [trigger],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active, emit: [out.create()] }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(trigger.create());
    } finally {
      console.warn = original;
    }
    expect(received).toEqual(["OUT"]);
    expect(warns).toEqual([]);
  });

  test("the machine sets the draining flag back between sends", () => {
    const idle = state("idle")();
    const active = state("active")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const stop = event("STOP")();
    const received: string[] = [];
    const actor = Actor({
      inputs: [trigger, stop],
      outputs: [out],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active, emit: [out.create()] }) });
        m.on(active, { eventRef: stop, handler: () => ({ state: idle, emit: [out.create()] }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(trigger.create());
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
    const actor = Actor({
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
        m.on(init, { eventRef: start, handler: () => ({ state: idle }) });
        m.on(idle, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    actor.send(start.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("the actor calls done subscribers only when reaching a final state", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let doneCalls = 0;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    actor.on("done", { fn: () => doneCalls++ });
    actor.send(trigger.create());
    expect(doneCalls).toBe(0);
  });

  test("an any handler handles the event when no state handler exists", () => {
    const idle = state("idle")();
    const active = state("active")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: tick, handler: () => ({ state: active }) });
      },
    });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("dispose() removes the running effect via its abort signal", () => {
    const idle = state("idle")();
    const running = state("running")();
    const start = event("START")();
    let effectSignal: AbortSignal | undefined;
    const actor = Actor({
      inputs: [start],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ state: running }) });
        m.effect(running, {
          name: "captureSignal",
          fn: ({ signal }) => {
            effectSignal = signal;
          },
        });
      },
    });
    actor.send(start.create());
    const abortedBeforeDispose = effectSignal?.aborted;
    actor.dispose();
    expect([abortedBeforeDispose, effectSignal?.aborted]).toEqual([false, true]);
  });
});

describe("Actor directed mutation tests", () => {
  test("the context getter returns the actor context", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      context: { n: 5 },
      setup: () => {},
    });
    expect(actor.context).toEqual({ n: 5 });
  });

  test("an internalBudget of zero fails the machine on the first event", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 0,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ emit: [loop.create()] }) });
        m.on(idle, { eventRef: loop, handler: () => ({ emit: [loop.create()] }) });
      },
    });
    actor.send(start.create());
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("initial state not declared throws", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    const declared: AnyStateRef[] = [a, b];
    expect(() =>
      Actor({
        inputs: [],
        states: declared,
        initial: stray,
        setup: () => {},
      }),
    ).toThrow(/stray/);
  });

  test("a region child that ignores output subscriptions still snapshots", () => {
    const idle = state("idle")();
    const stub: AnyActor = {
      state: state("s")(),
      clock: VirtualClock(),
      regions: {},
      send: () => {},
      inject: () => {},
      dispose: () => {},
      snapshot: () => ({ path: ["s"], context: {}, regions: {} }),
      on: () => () => {},
      recover: () => {},
      settled: async () => {},
    };
    const parent = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      regions: { child: stub },
      setup: () => {},
    });
    expect(parent.snapshot().regions.child.path[0]).toBe("s");
  });

  test("the machine treats a missing internal handler as an error-state transition", () => {
    const idle = state("idle")();
    const boom = event("BOOM")();
    const actor = Actor({
      inputs: [],
      internal: [boom],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.inject(boom.create());
    const snap = actor.snapshot();
    expect({ state: snap.path[0], reason: snap.error?.reason }).toEqual({
      state: "__error",
      reason: "unhandled",
    });
    expect(actor.snapshot().error?.event.type).toBe("BOOM");
  });

  test("the machine ignores an unhandled external event without dying", () => {
    const idle = state("idle")();
    const stray = event("STRAY")();
    const actor = Actor({
      inputs: [stray],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.send(stray.create());
    expect({ state: actor.state.name, error: actor.snapshot().error }).toEqual({
      state: "idle",
      error: undefined,
    });
  });

  test("dispose() on an actor with no running effect does not throw", () => {
    const idle = state("idle")();
    const actor = Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect(() => actor.dispose()).not.toThrow();
  });

  test("a transition to a state with no effects keeps the effect abort null", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(() => actor.dispose()).not.toThrow();
  });

  test("re-sending events from a change subscriber keeps draining without reentrancy errors", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const back = event("BACK")();
    const actor = Actor({
      inputs: [trigger, back],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.on(active, { eventRef: back, handler: () => ({ state: idle }) });
      },
    });
    actor.on("change", {
      fn: (snap) => {
        if (snap.path[0] === "active") actor.send(back.create());
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("idle");
  });

  test("an internalBudget of one fails the second event of a loop", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    let handlerCalls = 0;
    const actor = Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 1,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ emit: [loop.create()] }) });
        m.on(idle, {
          eventRef: loop,
          handler: () => {
            handlerCalls++;
            return { emit: [loop.create()] };
          },
        });
      },
    });
    actor.send(start.create());
    expect(handlerCalls).toBe(1);
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("the actor calls the output handler for unlisted event ids", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const received: string[] = [];
    const actor = Actor({
      inputs: [trigger],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ emit: [out.create()] }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(trigger.create());
    expect(received).toEqual(["OUT"]);
  });
});

describe("Actor directed mutation tests 2", () => {
  test("the actor ignores sends once final", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    const stray = event("STRAY")();
    let strayRuns = 0;
    const actor = Actor({
      inputs: [finish, stray],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
        m.onAny({
          eventRef: stray,
          handler: () => {
            strayRuns++;
            return {};
          },
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
    const declared: AnyStateRef[] = [a, b];
    expect(() =>
      Actor({
        inputs: [],
        states: declared,
        initial: stray,
        setup: () => {},
      }),
    ).toThrow(/stray/);
    expect(() =>
      Actor({
        inputs: [],
        states: declared,
        initial: stray,
        setup: () => {},
      }),
    ).toThrow(/a, b/);
  });

  test("the parent queue treats region child output as input and drains it", () => {
    const childIdle = state("cidle")();
    const childDone = state("cdone")();
    const childGo = event("CGO")();
    const doneEvt = event("CHILD_DONE")();
    const parentIdle = state("pidle")();
    const parentActive = state("pactive")();

    const child = Actor({
      inputs: [childGo],
      outputs: [doneEvt],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, {
          eventRef: childGo,
          handler: () => ({ state: childDone, emit: [doneEvt.create()] }),
        });
      },
    });

    const parent = Actor({
      inputs: [doneEvt],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, { eventRef: doneEvt, handler: () => ({ state: parentActive }) });
      },
    });

    child.send(childGo.create());
    const parentSnap = parent.snapshot();
    expect({
      parentState: parentSnap.path[0],
      childState: child.snapshot().path[0],
    }).toEqual({ parentState: "pactive", childState: "cdone" });
  });

  test("an any handler can emit without transitioning", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const out = event("OUT")();
    const received: string[] = [];
    const actor = Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: tick, handler: () => ({ emit: [out.create()] }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT"]);
  });

  test("a state handler transition keeps the any handler from transitioning for the same event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const tick = event("TICK")();
    let anyRuns = 0;
    const actor = Actor({
      inputs: [tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: tick, handler: () => ({ state: active }) });
        m.onAny({
          eventRef: tick,
          handler: () => {
            anyRuns++;
            return { state: idle };
          },
        });
      },
    });
    actor.send(tick.create());
    expect(anyRuns).toBe(1);
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("the actor calls done subscribers exactly once when reaching a final state", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let doneCalls = 0;
    const actor = Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
      },
    });
    actor.on("done", { fn: () => doneCalls++ });
    actor.send(finish.create());
    expect(doneCalls).toBe(1);
  });

  test("an effect emitting an input event dispatches through the input timerId set", () => {
    const clock = VirtualClock();
    const init = state("init")();
    const done = state("done")();
    const start = event("START")();
    const tick = event("TICK")();
    const actor = Actor({
      clock,
      inputs: [start, tick],
      internal: [],
      states: [init, done],
      initial: init,
      setup: (m) => {
        m.on(init, { eventRef: start, handler: () => ({ state: init }) });
        m.effect(init, {
          name: "emitTick",
          fn: ({ emit }) => {
            emit(tick.create());
          },
        });
        m.on(init, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    actor.send(start.create());
    clock.advance(1);
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("the machine calls state handlers with the actor in their options", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let gotActor: unknown;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: (_e, { actor: a }) => {
            gotActor = a;
            return { state: active };
          },
        });
      },
    });
    actor.send(trigger.create());
    expect(gotActor).toBe(actor);
    expect(actor.snapshot().path[0]).toBe("active");
  });
});

describe("Actor error state directed mutation tests", () => {
  test("a throwing handler cannot escape send", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("transition");
  });

  test("the machine treats death as terminal — later sends never resurrect it", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const bad = event("BAD")();
    let handlerCalls = 0;
    const actor = Actor({
      inputs: [trigger, bad],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({ eventRef: bad, handler: () => isErrorBomb("boom") });
        m.on(active, {
          eventRef: trigger,
          handler: () => {
            handlerCalls++;
            return { state: idle };
          },
        });
      },
    });
    actor.send(bad.create());
    actor.send(trigger.create());
    expect(handlerCalls).toBe(0);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a throwing subscriber leaves the machine running", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    actor.on("change", { fn: () => isErrorBomb("boom") });
    expect(() => actor.send(trigger.create())).not.toThrow();
    const snap = actor.snapshot();
    expect({ state: snap.path[0], error: snap.error }).toEqual({
      state: "active",
      error: undefined,
    });
  });

  test("budget exhaustion creates an error-state transition instead of a bare halt", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 1,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ emit: [loop.create()] }) });
        m.on(idle, { eventRef: loop, handler: () => ({ emit: [loop.create()] }) });
      },
    });
    expect(() => actor.send(start.create())).not.toThrow();
    const budgetSnap = actor.snapshot();
    expect({ reason: budgetSnap.error?.reason, state: budgetSnap.path[0] }).toEqual({
      reason: "budget",
      state: "__error",
    });
  });

  test("a throwing entry effect kills the machine and skips later effects", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const seen: string[] = [];
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "failFirst",
          fn: () => {
            seen.push("first");
            return isErrorBomb("boom");
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
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(seen).toEqual(["first"]);
    expect(actor.snapshot().error?.reason).toBe("effect");
  });

  test("a throwing output handler kills the machine", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ emit: [out.create()] }) });
      },
    });
    actor.on("output", { fn: () => isErrorBomb("output boom") });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("output");
  });

  test("the first error wins — a later throw does not replace it", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const bad = event("BAD")();
    const actor = Actor({
      inputs: [trigger, bad],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: trigger, handler: () => isErrorBomb("first") });
        m.onAny({ eventRef: bad, handler: () => isErrorBomb("second") });
      },
    });
    actor.send(trigger.create());
    actor.send(bad.create());
    const snap = actor.snapshot();
    expect(snap.error?.event.type).toBe("GO");
    expect(snap.error?.error instanceof Error).toBe(true);
    if (snap.error) {
      expect(errorMessage(snap.error.error)).toBe("first");
    }
  });

  test("death emits exactly one change and one done", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let changes = 0;
    let dones = 0;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.effect(active, {
          name: "throwOnEnter",
          fn: () => isErrorBomb("boom"),
        });
      },
    });
    actor.on("change", { fn: () => changes++ });
    actor.on("done", { fn: () => dones++ });
    changes = 0;
    actor.send(trigger.create());
    expect(changes).toBe(1);
    expect(dones).toBe(1);
  });

  test("an async rejection fails the machine once the run settles", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "rejectAsync",
          fn: async () => isErrorBomb("late boom"),
        });
      },
    });
    actor.send(trigger.create());
    await actor.settled();
    const effectDeathSnap = actor.snapshot();
    expect({ state: effectDeathSnap.path[0], reason: effectDeathSnap.error?.reason }).toEqual({
      state: "__error",
      reason: "effect",
    });
  });

  test("an any transition fails to resurrect a dead machine", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const bad = event("BAD")();
    let anyCalls = 0;
    const actor = Actor({
      inputs: [trigger, bad],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny({
          eventRef: trigger,
          handler: () => {
            anyCalls++;
            return { state: active };
          },
        });
        m.onAny({ eventRef: bad, handler: () => isErrorBomb("boom") });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect({ calls: anyCalls, state: actor.snapshot().path[0] }).toEqual({
      calls: 1,
      state: "active",
    });
    actor.send(bad.create());
    const afterBadSnap = actor.snapshot();
    expect({ calls: anyCalls, state: afterBadSnap.path[0] }).toEqual({
      calls: 1,
      state: "__error",
    });
    actor.send(trigger.create());
    const afterRetrySnap = actor.snapshot();
    expect([anyCalls, afterRetrySnap.path[0]]).toEqual([1, "__error"]);
  });

  test("the machine keeps the first error across reentrant drains", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    const actor = Actor({
      inputs: [trigger],
      outputs: [boom],
      internal: [boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.on(loading, { eventRef: boom, handler: () => isErrorBomb("nested") });
        m.effect(loading, {
          name: "emitBoomThenThrow",
          fn: ({ emit }) => {
            emit(boom.create());
            return isErrorBomb("outer");
          },
        });
      },
    });
    actor.send(trigger.create());
    const snap = actor.snapshot();
    expect({ reason: snap.error?.reason, eventType: snap.error?.event.type }).toEqual({
      reason: "transition",
      eventType: "BOOM",
    });
  });

  test("the machine dies even when a handler throws a falsy value", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isFalsyBomb() });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(actor.snapshot().error?.reason).toBe("transition");
  });

  test("an invalid transition target fails the machine", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const declaredStates: AnyStateRef[] = [idle];
    const actor = Actor({
      inputs: [trigger],
      states: declaredStates,
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: impostorState }) });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    const invalidTargetSnap = actor.snapshot();
    expect({
      reason: invalidTargetSnap.error?.reason,
      from: invalidTargetSnap.error?.state.name,
    }).toEqual({
      reason: "transition",
      from: "idle",
    });
  });

  test("the machine skips the Any handler after the state handler dies", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let ranAny = false;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
        m.onAny({
          eventRef: trigger,
          handler: () => {
            ranAny = true;
            return { state: active };
          },
        });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    expect(ranAny).toBe(false);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a successful output handler keeps the drain running", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const received: string[] = [];
    const actor = Actor({
      inputs: [trigger],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ emit: [out.create(), out.create()] }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(trigger.create());
    expect(received).toEqual(["OUT", "OUT"]);
  });

  test("the machine skips the spurious change after a change already consumed a context write", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const ping = event("PING")();
    let changes = 0;
    const actor = Actor({
      inputs: [trigger, ping],
      states: [idle],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: (_e, { context }) => {
            context.set({ n: 1 });
            return {};
          },
        });
        m.on(idle, { eventRef: ping, handler: () => ({}) });
      },
    });
    actor.on("change", { fn: () => changes++ });
    changes = 0;
    actor.send(trigger.create());
    actor.send(ping.create());
    expect(changes).toBe(1);
  });

  test("the invalid target error message keeps its deterministic text", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const declaredStates: AnyStateRef[] = [idle];
    const actor = Actor({
      inputs: [trigger],
      states: declaredStates,
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: impostorState }) });
      },
    });
    actor.send(trigger.create());
    const msg = actor.snapshot().error?.error;
    expect(msg instanceof Error && msg.message).toBe("invalid transition target");
  });

  test("a throw during a drain drops the remaining queued events", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    let boomCalls = 0;
    const actor = Actor({
      inputs: [trigger],
      outputs: [boom],
      internal: [boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: () => ({ state: loading, emit: [boom.create(), boom.create()] }),
        });
        m.on(loading, {
          eventRef: boom,
          handler: () => {
            boomCalls++;
            return isErrorBomb("boom");
          },
        });
      },
    });
    actor.send(trigger.create());
    expect(boomCalls).toBe(1);
    expect(actor.snapshot().path[0]).toBe("__error");
  });

  test("a resolving async effect keeps the machine alive", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    let settled = false;
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "settleAfterMicrotasks",
          fn: async () => {
            await Promise.resolve();
            settled = true;
          },
        });
      },
    });
    actor.send(trigger.create());
    await actor.settled();
    expect(settled).toBe(true);
    const healthySnap = actor.snapshot();
    expect({ state: healthySnap.path[0], error: healthySnap.error }).toEqual({
      state: "loading",
      error: undefined,
    });
  });

  test("settled resolves only after a delayed async rejection", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "rejectDelayed",
          fn: async () => {
            await Promise.resolve();
            await Promise.resolve();
            return Promise.reject(new Error("delayed boom"));
          },
        });
      },
    });
    actor.send(trigger.create());
    await actor.settled();
    const delayedSnap = actor.snapshot();
    expect(delayedSnap.error?.reason).toBe("effect");
    expect(delayedSnap.error?.error instanceof Error).toBe(true);
    if (delayedSnap.error) {
      expect(errorMessage(delayedSnap.error.error)).toBe("delayed boom");
    }
  });

  test("the machine ignores an output with no handler and survives", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ emit: [out.create()] }) });
      },
    });
    expect(() => actor.send(trigger.create())).not.toThrow();
    const idleSnap = actor.snapshot();
    expect({ state: idleSnap.path[0], error: idleSnap.error }).toEqual({
      state: "idle",
      error: undefined,
    });
  });

  test("the snapshot returns no error field while the machine is healthy", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    expect("error" in actor.snapshot()).toBe(false);
  });

  test("an output throw outside a dispatch records the current state", () => {
    const clock = VirtualClock();
    const idle = state("idle")();
    const out = event("OUT")();
    const actor = Actor({
      clock,
      inputs: [],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("output", { fn: () => isErrorBomb("boom") });
    actor.inject(out.create());
    const outputDeathSnap = actor.snapshot();
    expect({
      reason: outputDeathSnap.error?.reason,
      from: outputDeathSnap.error?.state.name,
    }).toEqual({
      reason: "output",
      from: "idle",
    });
  });

  test("the budget error keeps the deterministic message", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();
    const actor = Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 0,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ emit: [loop.create()] }) });
      },
    });
    actor.send(start.create());
    const budgetSnap = actor.snapshot();
    expect(budgetSnap.error?.reason).toBe("budget");
    expect(budgetSnap.error?.error instanceof Error).toBe(true);
    if (budgetSnap.error) {
      expect(errorMessage(budgetSnap.error.error)).toBe("internal event budget exceeded");
    }
  });

  test("an effect death sets the state being entered on the error info", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => isErrorBomb("boom"),
        });
      },
    });
    actor.send(trigger.create());
    const enteredSnap = actor.snapshot();
    expect({
      stateName: enteredSnap.error?.state.name,
      context: enteredSnap.error?.context,
    }).toEqual({
      stateName: "loading",
      context: {},
    });
  });

  test("the machine treats a payload-less event as an empty payload for payload-reading handlers", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    const actor = Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: update,
          handler: (e) => {
            void e.payload.codeSize;
            return {};
          },
        });
      },
    });
    const anyActor: AnyActor = actor;
    anyActor.send({ type: "UPDATE" });
    expect({ state: actor.state.name, error: actor.snapshot().error }).toEqual({
      state: "idle",
      error: undefined,
    });
  });

  test("the actor calls the transition hook for handled events and sets transitioned", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    });
    actor.send(trigger.create());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ from: "idle", to: "active", transitioned: true });
  });

  test("transition info keeps the exact names of effects that ran on entry", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.effect(active, { name: "markReady", fn: () => {} });
        m.effect(active, { name: "logEntry", fn: () => {} });
      },
    });
    const seen: Array<{ to: string; effects: string[] }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ to: info.to, effects: [...info.effects] }),
    });
    actor.send(trigger.create());
    expect(seen).toHaveLength(1);
    expect(seen[0].effects).toEqual(["markReady", "logEntry"]);
  });

  test("a transition into a state without effects returns an empty effects list", () => {
    const idle = state("idle")();
    const bare = state("bare")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, bare],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: bare }) });
      },
    });
    const seen: Array<string[]> = [];
    actor.on("transition", { fn: (info) => seen.push([...info.effects]) });
    actor.send(trigger.create());
    expect(seen).toEqual([[]]);
  });

  test("a handled no-op event returns an empty effects list", () => {
    const idle = state("idle")();
    const ping = event("PING")();
    const actor = Actor({
      inputs: [ping],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: ping, handler: () => ({}) });
      },
    });
    const seen: Array<string[]> = [];
    actor.on("transition", { fn: (info) => seen.push([...info.effects]) });
    actor.send(ping.create());
    expect(seen).toEqual([[]]);
  });

  test("the transition hook skips dropped events", () => {
    const idle = state("idle")();
    const stray = event("STRAY")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    let fires = 0;
    actor.on("transition", { fn: () => fires++ });
    const anyActor: AnyActor = actor;
    anyActor.send(stray.create());
    expect(fires).toBe(0);
  });

  test("the transition hook skips delivery once the machine is dead", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
      },
    });
    let fires = 0;
    actor.on("transition", { fn: () => fires++ });
    actor.send(trigger.create());
    expect(actor.snapshot().error?.reason).toBe("transition");
    expect(fires).toBe(0);
  });

  test("transition hook does not fire when a transition's effect throws", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => isErrorBomb("effect boom"),
        });
      },
    });
    let fires = 0;
    actor.on("transition", { fn: () => fires++ });
    actor.send(trigger.create());
    expect(actor.snapshot().error?.reason).toBe("effect");
    expect(fires).toBe(0);
  });

  test("a throwing transition subscriber is contained and the machine survives", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: idle }) });
      },
    });
    actor.on("transition", { fn: () => isErrorBomb("sub boom") });
    expect(() => actor.send(trigger.create())).not.toThrow();
    const survivedSnap = actor.snapshot();
    expect({ state: survivedSnap.path[0], error: survivedSnap.error }).toEqual({
      state: "idle",
      error: undefined,
    });
  });

  test("recover returns a dead machine to the caller-supplied state and context", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    let ticks = 0;
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle, loading],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "throwOnEnter",
          fn: () => isErrorBomb("effect boom"),
        });
        m.on(loading, {
          eventRef: tick,
          handler: () => {
            ticks++;
            return { state: idle };
          },
        });
      },
    });
    actor.send(trigger.create());
    const deadSnap = actor.snapshot();
    expect(deadSnap).toMatchObject({ error: { reason: "effect" } });
    actor.recover({ state: loading, context: { n: 7 } });
    const recoveredSnap = actor.snapshot();
    expect({ error: recoveredSnap.error, state: recoveredSnap.path[0] }).toEqual({
      error: undefined,
      state: "loading",
    });
    expect(actor.context).toEqual({ n: 7 });
    actor.send(tick.create());
    expect(ticks).toBe(1);
  });

  test("recover treats a live machine as a no-op", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      context: { n: 1 },
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: idle }) });
      },
    });
    let changes = 0;
    actor.on("change", { fn: () => changes++ });
    changes = 0;
    actor.recover({ state: idle, context: { n: 99 } });
    expect(changes).toBe(0);
    expect(actor.context).toEqual({ n: 1 });
  });

  test("the actor calls done subscribers exactly once", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    const actor = Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
      },
    });
    let dones = 0;
    actor.on("done", { fn: () => dones++ });
    actor.send(finish.create());
    expect(actor.snapshot().done).toBe(true);
    expect(dones).toBe(1);
  });

  test("the snapshot returns the payload of the current state", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: () => ({ state: ready, payload: { items: ["a"] } }),
        });
      },
    });
    const payloadBefore = actor.snapshot().payload;
    actor.send(trigger.create());
    expect([payloadBefore, actor.snapshot().payload]).toEqual([undefined, { items: ["a"] }]);
  });

  test("the snapshot returns no payload once the machine dies", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: () => ({ state: ready, payload: { items: ["a"] } }),
        });
        m.effect(ready, {
          name: "throwOnEnter",
          fn: () => isErrorBomb("boom"),
        });
      },
    });
    actor.send(trigger.create());
    const deadSnap = actor.snapshot();
    expect({ state: deadSnap.path[0], payload: deadSnap.payload }).toEqual({
      state: "__error",
      payload: undefined,
    });
  });

  test("the actor calls the output handler for unknown-typed events when internals are undeclared", () => {
    const idle = state("idle")();
    const out = event("OUT")();
    const actor = Actor({
      inputs: [],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const received: Array<{ type?: string }> = [];
    actor.on("output", { fn: (e) => received.push(e) });
    /**
     * A malformed wire envelope arrives untyped (JSON boundary), exactly like
     * production: the machine must route it to the output handler.
     */
    const malformed: InternalEvent = JSON.parse("{}");
    actor.inject(malformed);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBeUndefined();
  });
});

describe("dispose and inject directed mutation tests", () => {
  test("send and inject skip delivery after dispose()", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    const actor = Actor({
      inputs: [trigger],
      internal: [boom],
      states: [idle, active],
      initial: idle,
      setup: (m) => m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) }),
    });
    actor.dispose();
    actor.send(trigger.create());
    const afterSendSnap = { state: actor.state.name, error: actor.snapshot().error };
    expect(afterSendSnap).toEqual({ state: "idle", error: undefined });
    actor.inject(boom.create());
    const afterInjectSnap = actor.snapshot();
    expect({ state: afterInjectSnap.path[0], error: afterInjectSnap.error }).toEqual({
      state: "idle",
      error: undefined,
    });
  });

  test("dispose inside a transition drops later emits and skips effects", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    let effectRan = false;
    const actor = Actor({
      inputs: [trigger],
      outputs: [boom],
      internal: [boom],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: (_e, { actor: actorRef }) => {
            actorRef.dispose();
            return { state: active, emit: [boom.create()] };
          },
        });
        m.effect(active, {
          name: "markEffectRan",
          fn: () => {
            effectRan = true;
          },
        });
      },
    });
    actor.send(trigger.create());
    expect({ state: actor.state.name, error: actor.snapshot().error }).toEqual({
      state: "active",
      error: undefined,
    });
    expect(effectRan).toBe(false);
  });

  test("the error info keeps the exact message for an unhandled internal event", () => {
    const idle = state("idle")();
    const boom = event("BOOM")();
    const actor = Actor({
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
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      setup: (m) => m.onAny({ eventRef: tick, handler: () => ({}) }),
    });
    let changes = 0;
    actor.on("change", { fn: () => changes++ });
    expect(changes).toBe(1);
    actor.send(tick.create());
    expect(changes).toBe(1);
  });

  test("recover removes the change signal so a later no-op send stays silent", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("__error");
    actor.recover({ state: idle, context: {} });
    let changes = 0;
    actor.on("change", { fn: () => changes++ });
    expect(changes).toBe(1);
    actor.send(tick.create());
    expect(changes).toBe(1);
  });

  test("snapshots without payloads skip the payload key", () => {
    const idle = state("idle")();
    const actor = Actor({ inputs: [], states: [idle], initial: idle, setup: () => {} });
    expect("payload" in actor.snapshot()).toBe(false);
  });
});

describe("ActorBuilder registration invariants", () => {
  test("a single valid on() call registers and dispatches", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("two distinct events on the same state both set up working handlers", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const stop = event("STOP")();
    const actor = Actor({
      inputs: [trigger, stop],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.on(active, { eventRef: stop, handler: () => ({ state: idle }) });
      },
    });
    actor.send(trigger.create());
    const statesAfterSends = [actor.snapshot().path[0]];
    actor.send(stop.create());
    statesAfterSends.push(actor.snapshot().path[0]);
    expect(statesAfterSends).toEqual(["active", "idle"]);
  });

  test("a later on(state, event) call replaces the earlier handler", () => {
    const idle = state("idle")();
    const active = state("active")();
    const done = state("done")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.on(idle, { eventRef: trigger, handler: () => ({ state: done }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });

  test("a single valid onAny() call registers and dispatches", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: tick, handler: () => ({ state: active }) });
      },
    });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("a later onAny(event) call replaces the earlier handler", () => {
    const idle = state("idle")();
    const active = state("active")();
    const done = state("done")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active, done],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({ eventRef: trigger, handler: () => ({ state: done }) });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("done");
  });
});
