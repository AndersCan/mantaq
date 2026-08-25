import { expect, test, describe } from "vite-plus/test";
import { trackAbort, clearAbort } from "../src/abort-tracker.ts";
import { InternalQueue } from "../src/queue.ts";
import { Subscribers } from "../src/subscribers.ts";
import { runEffects } from "../src/effects.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { Context } from "../src/context.ts";
import { VirtualClock } from "../src/virtual-clock.ts";

describe("abort-tracker directed mutation tests", () => {
  test("trackAbort deletes the entry from the map when the signal aborts", () => {
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

  test("clearAbort removes the abort listener so a later abort keeps the entry", () => {
    const map = new Map<number, { signal?: AbortSignal; onAbort?: () => void }>();
    const controller = new AbortController();
    const onAbort = trackAbort(controller.signal, 1, map) as () => void;
    const timer = { signal: controller.signal, onAbort };
    map.set(1, timer);
    clearAbort(timer);
    controller.abort();
    expect(map.has(1)).toBe(true);
  });

  test("clearAbort on an entry without a signal does not throw", () => {
    clearAbort({});
  });
});

describe("InternalQueue directed mutation tests", () => {
  test("settled while processing resolves once the drain finishes", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    let resolved = false;
    const p = queue.settled();
    void p.then(() => {
      resolved = true;
    });
    queue.processCancellable(() => true);
    await p;
    expect(resolved).toBe(true);
  });

  test("multiple settled callers all resolve", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    const p1 = queue.settled();
    const p2 = queue.settled();
    queue.processCancellable(() => true);
    await Promise.all([p1, p2]);
  });

  test("events pushed during processing are drained in the same pass", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      if (e.type === "A") queue.push({ type: "B" });
      return true;
    });
    expect(seen).toEqual(["A", "B"]);
  });

  test("processCancellable stopping mid-drain drops the remaining events", () => {
    const queue = new InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return e.type !== "B";
    });
    expect(seen).toEqual(["A", "B"]);
    expect(queue.length).toBe(0);
  });

  test("clear drops pending events without draining", () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" }, { type: "B" });
    expect(queue.length).toBe(2);
    queue.clear();
    expect(queue.length).toBe(0);
  });

  test("clear resolves pending settled callers", async () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    const p = queue.settled();
    queue.clear();
    await p;
  });

  test("clear on an empty queue does not throw", () => {
    const queue = new InternalQueue();
    expect(() => queue.clear()).not.toThrow();
  });

  test("clear resets the cursor so later pushes process from the start", () => {
    const queue = new InternalQueue();
    queue.push({ type: "A" });
    queue.clear();
    queue.push({ type: "B" });
    const seen: string[] = [];
    queue.processCancellable((e) => {
      seen.push(e.type);
      return true;
    });
    expect(seen).toEqual(["B"]);
  });
});

describe("Subscribers directed mutation tests", () => {
  test("clear removes change and done subscribers", () => {
    const subs = new Subscribers<unknown>();
    let changes = 0;
    let dones = 0;
    subs.addChange(() => changes++);
    subs.addDone(() => dones++);
    subs.clear();
    subs.emitChange({ path: ["idle"], context: {}, regions: {} });
    subs.emitDone();
    expect(changes).toBe(0);
    expect(dones).toBe(0);
  });

  test("a throwing change subscriber is contained and the others still run", () => {
    const subs = new Subscribers<unknown>();
    const seen: string[] = [];
    subs.addChange(() => {
      throw new Error("boom");
    });
    subs.addChange((s) => seen.push(s.path[0]));
    expect(() => subs.emitChange({ path: ["active"], context: {}, regions: {} })).not.toThrow();
    expect(seen).toEqual(["active"]);
  });

  test("a throwing done subscriber is contained and the others still run", () => {
    const subs = new Subscribers<unknown>();
    const seen: string[] = [];
    subs.addDone(() => {
      throw new Error("boom");
    });
    subs.addDone(() => seen.push("ran"));
    expect(() => subs.emitDone()).not.toThrow();
    expect(seen).toEqual(["ran"]);
  });

  test("a throwing transition subscriber is contained", () => {
    const subs = new Subscribers<unknown>();
    subs.addTransition(() => {
      throw new Error("boom");
    });
    expect(() =>
      subs.emitTransition({
        event: { type: "GO" },
        from: "a",
        to: "b",
        effects: [],
        transitioned: true,
      }),
    ).not.toThrow();
  });

  test("a throwing subscriber during addChange seed is contained", () => {
    const subs = new Subscribers<unknown>();
    subs.seed({ path: ["idle"], context: {}, regions: {} });
    expect(() =>
      subs.addChange(() => {
        throw new Error("seed boom");
      }),
    ).not.toThrow();
  });

  test("a successful subscriber leaves everything untouched", () => {
    const subs = new Subscribers<unknown>();
    let calls = 0;
    subs.addChange(() => calls++);
    expect(() => subs.emitChange({ path: ["idle"], context: {}, regions: {} })).not.toThrow();
    expect(calls).toBe(1);
  });

  test("a non-Error thrown value is contained too", () => {
    const subs = new Subscribers<unknown>();
    subs.addChange(() => {
      throw "string boom";
    });
    expect(() => subs.emitChange({ path: ["idle"], context: {}, regions: {} })).not.toThrow();
  });

  test("the first emit passes the snapshot as prev when nothing was seeded", () => {
    const subs = new Subscribers<unknown>();
    let prevSnap: unknown;
    let first = true;
    subs.addChange((_s, prev) => {
      if (first) {
        first = false;
        prevSnap = prev;
      }
    });
    subs.emitChange({ path: ["active"], context: {}, regions: {} });
    expect(prevSnap).toEqual({ path: ["active"], context: {}, regions: {} });
  });

  test("add* hooks route each event tag and unsubscribe independently", () => {
    const subs = new Subscribers<unknown>();
    let changes = 0;
    let dones = 0;
    let transitions = 0;
    let errors = 0;
    const offChange = subs.addChange(() => changes++);
    const offDone = subs.addDone(() => dones++);
    const offTransition = subs.addTransition(() => transitions++);
    const offError = subs.addError(() => errors++);
    const snap = { path: ["idle"], context: {}, regions: {} };
    const info = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect" as const,
    };
    subs.emitChange(snap);
    subs.emitDone();
    subs.emitTransition({
      event: { type: "GO" },
      from: "a",
      to: "b",
      effects: [],
      transitioned: true,
    });
    subs.emitError(info);
    expect([changes, dones, transitions, errors]).toEqual([1, 1, 1, 1]);
    offChange();
    offDone();
    offTransition();
    offError();
    subs.emitChange(snap);
    subs.emitDone();
    subs.emitTransition({
      event: { type: "GO" },
      from: "a",
      to: "b",
      effects: [],
      transitioned: true,
    });
    subs.emitError(info);
    expect([changes, dones, transitions, errors]).toEqual([1, 1, 1, 1]);
  });

  test("addError seeds the last error stored on the snapshot to late subscribers", () => {
    const subs = new Subscribers<unknown>();
    const info = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect" as const,
    };
    subs.seed({ path: ["__error"], context: {}, regions: {}, error: info });
    const seen: unknown[] = [];
    subs.addError((e) => seen.push(e));
    expect(seen).toEqual([info]);
  });

  test("error subscriber throws are contained and other error subscribers still run", () => {
    const subs = new Subscribers<unknown>();
    const info = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect" as const,
    };
    const seen: unknown[] = [];
    subs.addError(() => {
      throw new Error("sub boom");
    });
    subs.addError((e) => seen.push(e));
    expect(() => subs.emitError(info)).not.toThrow();
    expect(seen).toEqual([info]);
  });

  test("clear removes error subscribers", () => {
    const subs = new Subscribers<unknown>();
    const info = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect" as const,
    };
    let errors = 0;
    subs.addError(() => errors++);
    subs.clear();
    subs.emitError(info);
    expect(errors).toBe(0);
  });

  test("output subscribers receive every event and unsubscribe independently", () => {
    const subs = new Subscribers<unknown>();
    const seen: string[] = [];
    const offA = subs.addOutput((e) => seen.push(e.type));
    const offB = subs.addOutput((e) => seen.push(e.type));
    subs.emitOutput({ type: "X" });
    expect(seen).toEqual(["X", "X"]);
    offA();
    subs.emitOutput({ type: "Y" });
    expect(seen).toEqual(["X", "X", "Y"]);
    offB();
    subs.emitOutput({ type: "Z" });
    expect(seen).toEqual(["X", "X", "Y"]);
  });

  test("clear removes output subscribers", () => {
    const subs = new Subscribers<unknown>();
    let calls = 0;
    subs.addOutput(() => calls++);
    subs.clear();
    subs.emitOutput({ type: "X" });
    expect(calls).toBe(0);
  });
});

describe("event directed mutation tests", () => {
  test("creates without a payload carry no payload key", () => {
    const ref = event("X")();
    const created = ref.create();
    expect(created).toEqual({ type: "X" });
    expect("payload" in created).toBe(false);
  });
});

describe("runEffects directed mutation tests", () => {
  function baseOptions() {
    const idle = state("idle")();
    return {
      effects: {},
      state: idle,
      statePayload: undefined,
      event: { type: "X" },
      context: new Context(
        () => ({}),
        () => {},
      ),
      emit: () => {},
      clock: new VirtualClock(),
      abort: new AbortController(),
      lastGood: { state: idle, context: {} },
      onError: () => {},
    };
  }

  test("a synchronous effect throw is routed to onError and stops the rest", () => {
    const seen: string[] = [];
    const result = runEffects({
      ...baseOptions(),
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
            fn: () => {
              throw new Error("boom");
            },
          },
          {
            name: "pushThree",
            fn: () => {
              seen.push("three");
            },
          },
        ],
      },
      onError: (error) => {
        expect((error as Error).message).toBe("boom");
      },
    });
    expect(seen).toEqual(["one"]);
    expect(result.ran).toEqual(["pushOne"]);
  });

  test("an async rejection is routed to onError", async () => {
    const seen: string[] = [];
    const result = runEffects({
      ...baseOptions(),
      effects: {
        idle: [
          {
            name: "lateThrow",
            fn: async () => {
              throw new Error("late boom");
            },
          },
        ],
      },
      onError: (error) => {
        seen.push((error as Error).message);
      },
    });
    await Promise.all(result.pending);
    expect(seen).toEqual(["late boom"]);
  });

  test("an abort-induced rejection is not reported", async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const result = runEffects({
      ...baseOptions(),
      abort,
      effects: {
        idle: [
          {
            name: "rejectOnAbort",
            fn: async ({ signal }) => {
              await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
              });
            },
          },
        ],
      },
      onError: () => {
        seen.push("reported");
      },
    });
    abort.abort();
    await Promise.all(result.pending);
    expect(seen).toEqual([]);
  });

  test("effects are skipped once the run is already aborted", () => {
    const seen: string[] = [];
    const abort = new AbortController();
    abort.abort();
    const result = runEffects({
      ...baseOptions(),
      abort,
      effects: {
        idle: [
          {
            name: "pushRan",
            fn: () => {
              seen.push("ran");
            },
          },
        ],
      },
    });
    expect(seen).toEqual([]);
    expect(result.ran).toEqual([]);
  });

  test("effects receive the entered state payload and event", () => {
    const seen: string[] = [];
    runEffects({
      ...baseOptions(),
      statePayload: { x: 5 },
      effects: {
        idle: [
          {
            name: "recordPayloadAndEvent",
            fn: ({ state, event }) => {
              seen.push(`${state.name}:${(state.payload as { x: number }).x}:${event.type}`);
            },
          },
        ],
      },
    });
    expect(seen).toEqual(["idle:5:X"]);
  });

  test("no effects for the state returns an empty pending list", () => {
    const result = runEffects(baseOptions());
    expect(result.pending).toEqual([]);
  });
});
