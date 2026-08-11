import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "../src/virtual-clock.ts";
import { RealClock } from "../src/real-clock.ts";
import { InternalQueue } from "../src/queue.ts";
import { trackAbort, clearAbort } from "../src/abort-tracker.ts";
import { runEffects } from "../src/effects.ts";
import { Subscribers } from "../src/subscribers.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { parseTarget } from "../src/dispatch.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { Context } from "../src/context.ts";

describe("VirtualClock", () => {
  test("now starts at zero and advance moves it", () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
    clock.advance(100);
    expect(clock.now()).toBe(100);
  });

  test("setTimeout fires at its deadline", () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(50, () => fired.push(1));
    clock.setTimeout(100, () => fired.push(2));
    clock.advance(60);
    expect(fired).toEqual([1]);
    clock.advance(40);
    expect(fired).toEqual([1, 2]);
    expect(clock.now()).toBe(100);
  });

  test("clearTimeout cancels a pending timer", () => {
    const clock = new VirtualClock();
    let fired = 0;
    const id = clock.setTimeout(50, () => fired++);
    clock.clearTimeout(id);
    clock.advance(100);
    expect(fired).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  test("setInterval fires repeatedly and reschedules", () => {
    const clock = new VirtualClock();
    let count = 0;
    clock.setInterval(20, () => count++);
    clock.advance(45);
    expect(count).toBe(2);
    expect(clock.now()).toBe(45);
  });

  test("clearInterval stops future firings", () => {
    const clock = new VirtualClock();
    let count = 0;
    const id = clock.setInterval(20, () => count++);
    clock.advance(25);
    clock.clearInterval(id);
    clock.advance(100);
    expect(count).toBe(1);
  });

  test("hasPending reflects timers and intervals", () => {
    const clock = new VirtualClock();
    expect(clock.hasPending()).toBe(false);
    clock.setTimeout(10, () => {});
    expect(clock.hasPending()).toBe(true);
    clock.advance(10);
    expect(clock.hasPending()).toBe(false);
  });

  test("pendingTimers reports id, deadline, ms and eventName", () => {
    const clock = new VirtualClock();
    clock.setTimeout(30, () => {}, { eventName: "tick" });
    const pending = clock.pendingTimers();
    expect(pending.length).toBe(1);
    expect(pending[0].ms).toBe(30);
    expect(pending[0].eventName).toBe("tick");
    expect(pending[0].deadline).toBe(30);
    expect(typeof pending[0].id).toBe("number");
  });

  test("setDrain callback runs on advance", () => {
    const clock = new VirtualClock();
    let drained = 0;
    clock.setDrain(() => drained++);
    clock.advance(10);
    expect(drained).toBe(1);
  });
});

describe("RealClock", () => {
  test("now returns increasing values", () => {
    const clock = new RealClock();
    const first = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });

  test("setTimeout fires and returns a numeric id", () => {
    const clock = new RealClock();
    let fired = false;
    const id = clock.setTimeout(5, () => {
      fired = true;
    });
    expect(typeof id).toBe("number");
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(true);
        resolve();
      }, 30),
    );
  });

  test("clearTimeout cancels", () => {
    const clock = new RealClock();
    let fired = false;
    const id = clock.setTimeout(5, () => {
      fired = true;
    });
    clock.clearTimeout(id);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(false);
        resolve();
      }, 30),
    );
  });

  test("setInterval fires and clearInterval stops it", () => {
    const clock = new RealClock();
    let count = 0;
    const id = clock.setInterval(5, () => count++);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        clock.clearInterval(id);
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
  test("processCancellable drains events in order", () => {
    const queue = new InternalQueue();
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
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return e.type !== "B";
    });
    expect(seen).toEqual(["A", "B"]);
  });

  test("settled resolves when queue is idle", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    const settled = queue.settled();
    queue.processCancellable(() => true);
    await settled;
    expect(queue.length).toBe(0);
  });

  test("settled resolves immediately when already idle", async () => {
    const queue = new InternalQueue();
    await queue.settled();
  });

  test("length counts pending events", () => {
    const queue = new InternalQueue();
    expect(queue.length).toBe(0);
    queue.push({ type: "A" });
    queue.push({ type: "B" });
    expect(queue.length).toBe(2);
  });
});

describe("abort-tracker", () => {
  test("trackAbort deletes from map on abort", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    const controller = new AbortController();
    map.set(1, { signal: controller.signal });
    trackAbort(controller.signal, 1, map);
    controller.abort();
    expect(map.has(1)).toBe(false);
  });

  test("trackAbort returns undefined without a signal", () => {
    const map = new Map<number, { signal?: AbortSignal }>();
    expect(trackAbort(undefined, 1, map)).toBeUndefined();
  });

  test("clearAbort removes the abort listener", () => {
    const map = new Map<number, { signal?: AbortSignal; onAbort?: () => void }>();
    const controller = new AbortController();
    const onAbort = trackAbort(controller.signal, 1, map) as () => void;
    const timer = { signal: controller.signal, onAbort };
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
  });

  test("returns no pending when no effects for the state", () => {
    const result = runEffects({
      effects: {},
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

  test("runs effects with input and returns no pending for sync effects", () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const result = runEffects({
      effects: {
        idle: [
          ({ signal, state, event, context, emit, clock: c }) => {
            expect(signal.aborted).toBe(false);
            expect(state.name).toBe("idle");
            expect(event.type).toBe("X");
            expect(context.get()).toEqual({ n: 1 });
            expect(c).toBe(clock);
            emit({ type: "OUT" });
            seen.push("ran");
          },
        ],
      },
      state: state("idle")(),
      statePayload: { x: 1 },
      event: { type: "X" },
      context: new Context(
        () => ({ n: 1 }),
        () => {},
      ),
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
          () => {
            seen.push("one");
          },
          () => {
            throw new Error("boom");
          },
          () => {
            seen.push("three");
          },
        ],
      },
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
      onError: (error) => {
        expect((error as Error).message).toBe("boom");
      },
    });
    expect(seen).toEqual(["one"]);
  });

  test("routes an async rejection to onError after abort guard passes", async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const result = runEffects({
      effects: {
        idle: [
          async () => {
            throw new Error("late boom");
          },
        ],
      },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
      abort,
      lastGood: { state: state("idle")(), context: {} },
      onError: (error) => {
        seen.push((error as Error).message);
      },
    });
    await Promise.all(result.pending);
    expect(seen).toEqual(["late boom"]);
  });

  test("does not report a rejection caused by abort", async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const result = runEffects({
      effects: {
        idle: [
          async ({ signal }) => {
            await new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
          },
        ],
      },
      state: state("idle")(),
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
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
});

describe("Subscribers", () => {
  test("change subscribers fire with snapshot and unsubscribe removes", () => {
    const subs = new Subscribers<Record<string, never>>();
    const snap = { path: ["idle"], context: {}, regions: {} };
    const seen: string[] = [];
    const off = subs.addChange((s) => seen.push(s.path[0]));
    subs.emitChange(snap);
    off();
    subs.emitChange(snap);
    expect(seen).toEqual(["idle"]);
  });

  test("done subscribers fire and clear empties", () => {
    const subs = new Subscribers();
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
    const snap = buildSnapshot(
      state("root")(),
      { sub: { snapshot: () => ({ path: ["leaf"], context: {}, regions: {} }) } },
      { n: 1 },
    );
    expect(snap.path).toEqual(["root"]);
    expect(snap.context).toEqual({ n: 1 });
    expect(snap.regions.sub.path).toEqual(["leaf"]);
    expect(snap.done).toBeUndefined();
  });

  test("marks done for final states", () => {
    const snap = buildSnapshot(state("done")().final(), {}, {});
    expect(snap.done).toBe(true);
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
    expect(result?.state).toBe(idle);
    expect(result?.payload).toEqual({ x: 3 });
  });

  test("returns undefined when no state", () => {
    expect(parseTarget({})).toBeUndefined();
  });
});

describe("event ref", () => {
  test("create builds envelope with type and payload", () => {
    const e = event("GO")<{ x: number }>();
    expect(e.create({ x: 1 })).toEqual({ type: "GO", payload: { x: 1 } });
  });

  test("create without payload produces id only", () => {
    const e = event("PING")();
    expect(e.create()).toEqual({ type: "PING" });
  });

  test("is matches by id", () => {
    const a = event("A")<{ x: number }>();
    expect(a.is({ type: "A", x: 1 })).toBe(true);
    expect(a.is({ type: "B" })).toBe(false);
    expect(a.is(null)).toBe(false);
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
    expect(done.isFinal).toBe(true);
    expect(done._regions).toBe(idle._regions);
  });
});
