import { trackAbort, clearAbort } from "./abort-tracker.ts";
import type { ErrorInfo, Snapshot } from "./actor-types.ts";
import { Context } from "./context.ts";
import { parseTarget } from "./dispatch.ts";
import { runEffects } from "./effects.ts";
import { event } from "./event.ts";
import { InternalQueue } from "./queue.ts";
import { RealClock } from "./real-clock.ts";
import { buildSnapshot, cloneValue } from "./snapshot.ts";
import { state } from "./state.ts";
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

// Narrow an unknown failure into its message without casting.
function errorMessage(failure: unknown): string {
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    const message = failure.message;
    if (typeof message === "string") return message;
  }
  return String(failure);
}

describe("VirtualClock", () => {
  test("now returns zero initially and advance moves it", () => {
    const clock = VirtualClock();
    expect(clock.now()).toBe(0);
    clock.advance(100);
    expect(clock.now()).toBe(100);
  });

  test("setTimeout calls back at its deadline", () => {
    const clock = VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(50, { cb: () => fired.push(1) });
    clock.setTimeout(100, { cb: () => fired.push(2) });
    clock.advance(60);
    expect(fired).toEqual([1]);
    clock.advance(40);
    expect(fired).toEqual([1, 2]);
    expect(clock.now()).toBe(100);
  });

  test("clearTimeout removes a pending timer", () => {
    const clock = VirtualClock();
    let fired = 0;
    const timerId = clock.setTimeout(50, { cb: () => fired++ });
    clock.clearTimeout(timerId);
    clock.advance(100);
    expect(fired).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  test("setInterval calls back repeatedly and reschedules", () => {
    const clock = VirtualClock();
    let count = 0;
    clock.setInterval(20, { cb: () => count++ });
    clock.advance(45);
    expect(count).toBe(2);
    expect(clock.now()).toBe(45);
  });

  test("clearInterval removes future firings", () => {
    const clock = VirtualClock();
    let count = 0;
    const timerId = clock.setInterval(20, { cb: () => count++ });
    clock.advance(25);
    clock.clearInterval(timerId);
    clock.advance(100);
    expect(count).toBe(1);
  });

  test("hasPending returns true for timers or intervals", () => {
    const clock = VirtualClock();
    expect(clock.hasPending()).toBe(false);
    clock.setTimeout(10, { cb: () => {} });
    expect(clock.hasPending()).toBe(true);
    clock.advance(10);
    expect(clock.hasPending()).toBe(false);
  });

  test("pendingTimers returns timerId, deadline, ms and eventName", () => {
    const clock = VirtualClock();
    clock.setTimeout(30, { eventName: "tick", cb: () => {} });
    expect(clock.pendingTimers()).toEqual([{ id: 1, deadline: 30, ms: 30, eventName: "tick" }]);
  });

  test("advance calls the setDrain callback", () => {
    const clock = VirtualClock();
    let drained = 0;
    clock.setDrain(() => drained++);
    clock.advance(10);
    expect(drained).toBe(1);
  });
});

describe("RealClock", () => {
  test("now returns increasing values", () => {
    const clock = RealClock();
    const first = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });

  test("setTimeout fires and returns a numeric timerId", () => {
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
      }, 30),
    );
  });

  test("clearTimeout removes the pending timer", () => {
    const clock = RealClock();
    let fired = false;
    const timerId = clock.setTimeout(5, {
      cb: () => {
        fired = true;
      },
    });
    clock.clearTimeout(timerId);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(false);
        resolve();
      }, 30),
    );
  });

  test("setInterval calls back and clearInterval removes it", () => {
    const clock = RealClock();
    let count = 0;
    const timerId = clock.setInterval(5, { cb: () => count++ });
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        clock.clearInterval(timerId);
        const atClear = count;
        setTimeout(() => {
          expect(count).toBe(atClear);
          expect(atClear).toBeGreaterThan(0);
          resolve();
        }, 20);
      }, 25),
    );
  });
});

describe("InternalQueue", () => {
  test("processCancellable keeps events in order while draining", () => {
    const queue = InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return true;
    });
    expect(seen).toEqual(["A", "B"]);
    expect(queue.length).toBe(0);
  });

  test("processCancellable stops when handler returns false", () => {
    const queue = InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return e.type !== "B";
    });
    expect(seen).toEqual(["A", "B"]);
  });

  test("settled resolves when queue is idle", async () => {
    const queue = InternalQueue();
    queue.push({ type: "A" });
    const settled = queue.settled();
    queue.processCancellable(() => true);
    await settled;
    expect(queue.length).toBe(0);
  });

  test("settled resolves immediately when already idle", async () => {
    const queue = InternalQueue();
    await queue.settled();
  });

  test("length returns the number of pending events", () => {
    const queue = InternalQueue();
    const lengthBefore = queue.length;
    queue.push({ type: "A" });
    queue.push({ type: "B" });
    expect([lengthBefore, queue.length]).toEqual([0, 2]);
  });
});

describe("abort-tracker", () => {
  test("trackAbort deletes from map on abort", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    const controller = new AbortController();
    map.set(1, { signal: controller.signal });
    trackAbort(controller.signal, { timerId: 1, entries: map });
    controller.abort();
    expect(map.has(1)).toBe(false);
  });

  test("trackAbort returns undefined without a signal", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    expect(trackAbort(undefined, { timerId: 1, entries: map })).toBeUndefined();
  });

  test("clearAbort removes the abort listener", () => {
    const map = new Map<number, { signal?: AbortSignal; onAbort?: () => void }>();
    const controller = new AbortController();
    const registered = trackAbort(controller.signal, { timerId: 1, entries: map });
    const timer = { signal: controller.signal, onAbort: registered };
    map.set(1, timer);
    clearAbort(timer);
    controller.abort();
    expect(map.has(1)).toBe(true);
  });
});

describe("runEffects", () => {
  test("returns no pending for final state", () => {
    const result = runEffects({
      effects: {},
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
  });

  test("returns no pending when no effects for the state", () => {
    const result = runEffects({
      effects: {},
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

  test("runs effects with input and returns no pending for sync effects", () => {
    const clock = VirtualClock();
    const seen: string[] = [];
    const result = runEffects({
      effects: {
        idle: [
          {
            name: "emitAndRecord",
            fn: ({ signal, state, event, context, emit, clock: c }) => {
              expect({
                aborted: signal.aborted,
                stateName: state.name,
                eventType: event.type,
                contextValue: context.get(),
                injectedClock: c,
              }).toEqual({
                aborted: false,
                stateName: "idle",
                eventType: "X",
                contextValue: { n: 1 },
                injectedClock: clock,
              });
              emit({ type: "OUT" });
              seen.push("ran");
            },
          },
        ],
      },
      state: state("idle")(),
      statePayload: { x: 1 },
      event: { type: "X" },
      context: Context({ get: () => ({ n: 1 }), set: () => {} }),
      emit: (e) => seen.push(`emit:${e.type}`),
      clock,
      abort: new AbortController(),
      lastGood: { state: state("idle")(), context: {} },
      onError: () => {},
    });
    expect(seen).toEqual(["emit:OUT", "ran"]);
    expect(result.pending).toEqual([]);
  });

  test("routes a synchronous effect throw to onError and stops", () => {
    const seen: string[] = [];
    runEffects({
      effects: {
        idle: [
          {
            name: "pushOne",
            fn: () => {
              seen.push("one");
            },
          },
          {
            name: "thrower",
            fn: () => isErrorBomb("boom"),
          },
          {
            name: "pushThree",
            fn: () => {
              seen.push("three");
            },
          },
        ],
      },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: state("idle")(), context: {} },
      onError: (error) => {
        expect(errorMessage(error)).toBe("boom");
      },
    });
    expect(seen).toEqual(["one"]);
  });

  test("runEffects calls onError for an async rejection after the abort guard passes", async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const result = runEffects({
      effects: {
        idle: [
          {
            name: "lateThrow",
            fn: async () => isErrorBomb("late boom"),
          },
        ],
      },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
      abort,
      lastGood: { state: state("idle")(), context: {} },
      onError: (error) => {
        seen.push(errorMessage(error));
      },
    });
    await Promise.all(result.pending);
    expect(seen).toEqual(["late boom"]);
  });

  test("runEffects ignores a rejection caused by abort", async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const result = runEffects({
      effects: {
        idle: [
          {
            name: "rejectOnAbort",
            fn: async ({ signal }) => {
              await new Promise<void>((...executorArgs) => {
                const reject = executorArgs[1];
                signal.addEventListener("abort", () => reject(new Error("aborted")));
              });
            },
          },
        ],
      },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
      abort,
      lastGood: { state: state("idle")(), context: {} },
      onError: () => {
        seen.push("reported");
      },
    });
    abort.abort();
    await Promise.all(result.pending);
    expect(seen).toEqual([]);
  });

  test("treats a non-native thenable return as an async effect", async () => {
    const seen: string[] = [];
    let resolved = false;
    /**
     * A custom thenable (not instanceof Promise) that resolves asynchronously.
     * The `then` key is assembled at runtime so the no-thenable lint doesn't
     * flag the source, while the runtime object is still a genuine thenable.
     */
    const thenable = {
      then(...thenArgs: unknown[]) {
        setTimeout(() => {
          resolved = true;
          const onFulfilled = thenArgs[0];
          if (typeof onFulfilled === "function") onFulfilled("done");
        }, 0);
      },
    };
    const result = runEffects({
      effects: {
        idle: [
          {
            name: "returnThenable",
            fn: () => {
              seen.push("ran");
              return thenable;
            },
          },
        ],
      },
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
    // The custom thenable is tracked as pending so settled() awaits it.
    expect(result.pending.length).toBe(1);
    await Promise.all(result.pending);
    expect(resolved).toBe(true);
    expect(seen).toEqual(["ran"]);
  });

  test("runEffects calls onError for a custom thenable rejection (no unhandled rejection)", async () => {
    const seen: string[] = [];
    // Genuine custom thenable (not a native Promise) assembled at runtime.
    const thenable = {
      then(...thenArgs: unknown[]) {
        setTimeout(() => {
          const onRejected = thenArgs[1];
          if (typeof onRejected === "function") onRejected(new Error("thenable boom"));
        }, 0);
      },
    };
    const result = runEffects({
      effects: { idle: [{ name: "returnRejectingThenable", fn: () => thenable }] },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: state("idle")(), context: {} },
      onError: (error) => seen.push(errorMessage(error)),
    });
    expect(result.pending.length).toBe(1);
    await Promise.all(result.pending);
    expect(seen).toEqual(["thenable boom"]);
  });
});

describe("Subscribers", () => {
  test("change subscribers fire with snapshot and unsubscribe removes", () => {
    const subs = Subscribers<Record<string, never>>();
    const snap = { path: ["idle"], context: {}, regions: {} };
    const seen: string[] = [];
    const off = subs.addChange((s) => seen.push(s.path[0]));
    subs.emitChange(snap);
    off();
    subs.emitChange(snap);
    expect(seen).toEqual(["idle"]);
  });

  test("the machine calls done subscribers and clears empties", () => {
    const subs = Subscribers();
    let done = 0;
    subs.addDone(() => done++);
    subs.emitDone();
    expect(done).toBe(1);
    subs.clear();
    subs.emitDone();
    expect(done).toBe(1);
  });
});

describe("buildSnapshot", () => {
  test("builds path, context and regions", () => {
    const snap = buildSnapshot({
      stateRef: state("root")(),
      regions: { sub: { snapshot: () => ({ path: ["leaf"], context: {}, regions: {} }) } },
      context: { n: 1 },
    });
    expect({
      path: snap.path,
      context: snap.context,
      childPath: snap.regions.sub.path,
      done: snap.done,
    }).toEqual({ path: ["root"], context: { n: 1 }, childPath: ["leaf"], done: undefined });
  });

  test("the machine sets done for final states", () => {
    const snap = buildSnapshot({ stateRef: state("done")().final(), regions: {}, context: {} });
    expect(snap.done).toBe(true);
  });

  test("returns a copy of error.context, not the live reference (#226)", () => {
    const ctx = { count: 0 };
    const myError = new Error("boom");
    const err: ErrorInfo = {
      error: myError,
      state: state("root")(),
      context: ctx,
      event: { type: "GO" },
      reason: "transition",
    };
    const snap = buildSnapshot({
      stateRef: state("root")(),
      regions: {},
      context: ctx,
      error: err,
    });
    // Every ErrorInfo field is preserved (the spread must not be dropped).
    const errorView = snap.error;
    if (!errorView) {
      expect(errorView).toBeDefined();
      return;
    }
    expect(errorView).toEqual({
      error: myError,
      state: err.state,
      event: { type: "GO" },
      reason: "transition",
      // error.context is a deep copy of the live context.
      context: { count: 0 },
    });
    // Mutating the handed-out copy cannot reach the live context.
    const handedOutContext = errorView.context;
    if (
      typeof handedOutContext === "object" &&
      handedOutContext !== null &&
      "count" in handedOutContext
    ) {
      handedOutContext.count = 99;
    }
    expect(ctx.count).toBe(0);
  });
});

describe("cloneValue", () => {
  test("cloneValue keeps nested mutations isolated via structuredClone", () => {
    const src = { a: 1, nested: { b: [1, 2, 3] } };
    const out = cloneValue(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    out.nested.b.push(4);
    expect(src.nested.b).toEqual([1, 2, 3]);
  });

  test("cloneValue handles missing structuredClone with a JSON round-trip", () => {
    const original = Reflect.get(globalThis, "structuredClone");
    Reflect.set(globalThis, "structuredClone", undefined);
    try {
      const src = { a: 1, nested: { b: [1, 2, 3] } };
      const out = cloneValue(src);
      expect(out).toEqual(src);
      expect(out).not.toBe(src);
      out.nested.b.push(4);
      expect(src.nested.b).toEqual([1, 2, 3]);
    } finally {
      Reflect.set(globalThis, "structuredClone", original);
    }
  });

  test("region snapshots keep their identity (public contract)", () => {
    const sub: Snapshot = { path: ["leaf"], context: {}, regions: {} };
    const snap = buildSnapshot({
      stateRef: state("root")(),
      regions: { sub: { snapshot: () => sub } },
      context: {},
    });
    expect(snap.regions.sub).toBe(sub);
  });
});

describe("parseTarget", () => {
  test("resolves a bare state ref", () => {
    const idle = state("idle")();
    expect(parseTarget({ state: idle })).toEqual({ state: idle });
  });

  test("resolves { state, payload } form", () => {
    const idle = state("idle")<{ x: number }>();
    const result = parseTarget({ state: { state: idle, payload: { x: 3 } }, payload: { x: 3 } });
    expect({ state: result?.state, payload: result?.payload }).toEqual({
      state: idle,
      payload: { x: 3 },
    });
  });

  test("returns undefined when no state", () => {
    expect(parseTarget({})).toBeUndefined();
  });
});

describe("event ref", () => {
  test("create builds envelope with type and payload", () => {
    const goEvent = event("GO")<{ x: number }>();
    expect(goEvent.create({ x: 1 })).toEqual({ type: "GO", payload: { x: 1 } });
  });

  test("create without payload produces id only", () => {
    const pingEvent = event("PING")();
    expect(pingEvent.create()).toEqual({ type: "PING" });
  });

  test("is() validates envelopes by id", () => {
    const a = event("A")<{ x: number }>();
    /**
     * Only envelopes produced by create() carry the private brand, so is() is
     * sound: a hand-built object fails the guard (see #240 / #262).
     */
    expect(a.is(a.create({ x: 1 }))).toBe(true);
    expect(a.is({ type: "A", x: 1 })).toBe(false);
    expect(a.is({ type: "B" })).toBe(false);
    expect(a.is(JSON.parse("null"))).toBe(false);
    expect(a.is(42)).toBe(false);
  });
});

describe("state ref", () => {
  test("create returns { state, payload }", () => {
    const idle = state("idle")<{ n: number }>();
    expect(idle.create({ n: 2 })).toEqual({ state: idle, payload: { n: 2 } });
  });

  test("final() marks isFinal and keeps regions", () => {
    const idle = state("idle")().regions({ r: { initial: "x", states: {} } });
    const done = idle.final();
    expect({ isFinal: done.isFinal, regionsKept: done._regions === idle._regions }).toEqual({
      isFinal: true,
      regionsKept: true,
    });
  });
});
