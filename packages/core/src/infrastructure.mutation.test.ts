import { trackAbort, clearAbort } from "./abort-tracker.ts";
import { type ErrorInfo } from "./actor-types.ts";
import { Context } from "./context.ts";
import { runEffects } from "./effects.ts";
import { event } from "./event.ts";
import { InternalQueue } from "./queue.ts";
import { state } from "./state.ts";
import { Subscribers } from "./subscribers.ts";
import { VirtualClock } from "./virtual-clock.ts";
import { expect, test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 * Narrow an unknown failure into its message without casting.
 */
function errorMessage(failure: unknown): string {
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    const message = failure.message;
    if (typeof message === "string") return message;
  }
  return String(failure);
}

function isErrorBomb(value: unknown): never {
  throw value;
}

describe("abort-tracker directed mutation tests", () => {
  test("trackAbort deletes the entry from the map when the signal aborts", () => {
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

  test("clearAbort removes the abort listener so a later abort keeps the entry", () => {
    const map = new Map<number, { signal?: AbortSignal; onAbort?: () => void }>();
    const controller = new AbortController();
    const registered = trackAbort(controller.signal, { timerId: 1, entries: map });
    const timer = { signal: controller.signal, onAbort: registered };
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
    const queue = InternalQueue();
    queue.push({ type: "A" });
    let resolved = false;
    const settledPromise = queue.settled();
    void settledPromise.then(() => {
      resolved = true;
    });
    queue.processCancellable(() => true);
    await settledPromise;
    expect(resolved).toBe(true);
  });

  test("multiple settled callers all resolve", async () => {
    const queue = InternalQueue();
    queue.push({ type: "A" });
    const firstSettled = queue.settled();
    const secondSettled = queue.settled();
    queue.processCancellable(() => true);
    await Promise.all([firstSettled, secondSettled]);
  });

  test("processCancellable keeps draining events pushed during processing in the same pass", () => {
    const queue = InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      if (e.type === "A") queue.push({ type: "B" });
      return true;
    });
    expect(seen).toEqual(["A", "B"]);
  });

  test("processCancellable stopping mid-drain skips the remaining events", () => {
    const queue = InternalQueue();
    const seen: string[] = [];
    queue.push({ type: "A" }, { type: "B" }, { type: "C" });
    queue.processCancellable((e) => {
      seen.push(e.type);
      return e.type !== "B";
    });
    expect(seen).toEqual(["A", "B"]);
    expect(queue.length).toBe(0);
  });

  test("clear removes pending events without draining them again", () => {
    const queue = InternalQueue();
    queue.push({ type: "A" }, { type: "B" });
    const lengthBeforeClear = queue.length;
    queue.clear();
    expect([lengthBeforeClear, queue.length]).toEqual([2, 0]);
  });

  test("clear resolves pending settled callers", async () => {
    const queue = InternalQueue();
    queue.push({ type: "A" });
    const settledPromise = queue.settled();
    queue.clear();
    await settledPromise;
  });

  test("clear on an empty queue does not throw", () => {
    const queue = InternalQueue();
    expect(() => queue.clear()).not.toThrow();
  });

  test("clear sets the cursor back so later pushes process from the start", () => {
    const queue = InternalQueue();
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
    const subs = Subscribers<unknown>();
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
    const subs = Subscribers<unknown>();
    const seen: string[] = [];
    subs.addChange(() => isErrorBomb("boom"));
    subs.addChange((s) => seen.push(s.path[0]));
    expect(() => subs.emitChange({ path: ["active"], context: {}, regions: {} })).not.toThrow();
    expect(seen).toEqual(["active"]);
  });

  test("a throwing done subscriber is contained and the others still run", () => {
    const subs = Subscribers<unknown>();
    const seen: string[] = [];
    subs.addDone(() => isErrorBomb("boom"));
    subs.addDone(() => seen.push("ran"));
    expect(() => subs.emitDone()).not.toThrow();
    expect(seen).toEqual(["ran"]);
  });

  test("a throwing transition subscriber is contained", () => {
    const subs = Subscribers<unknown>();
    subs.addTransition(() => isErrorBomb("boom"));
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
    const subs = Subscribers<unknown>();
    subs.seed({ path: ["idle"], context: {}, regions: {} });
    expect(() => subs.addChange(() => isErrorBomb("seed boom"))).not.toThrow();
  });

  test("a successful subscriber keeps everything untouched", () => {
    const subs = Subscribers<unknown>();
    let calls = 0;
    subs.addChange(() => calls++);
    expect(() => subs.emitChange({ path: ["idle"], context: {}, regions: {} })).not.toThrow();
    expect(calls).toBe(1);
  });

  test("the error path handles a non-Error thrown value too", () => {
    const subs = Subscribers<unknown>();
    subs.addChange(() => isErrorBomb("string boom"));
    expect(() => subs.emitChange({ path: ["idle"], context: {}, regions: {} })).not.toThrow();
  });

  test("the first emit passes the snapshot as prev when nothing was seeded", () => {
    const subs = Subscribers<unknown>();
    let prevSnap: unknown;
    let first = true;
    subs.addChange((...changeArgs) => {
      if (first) {
        first = false;
        prevSnap = changeArgs[1];
      }
    });
    subs.emitChange({ path: ["active"], context: {}, regions: {} });
    expect(prevSnap).toEqual({ path: ["active"], context: {}, regions: {} });
  });

  test("add* hooks route each event tag and unsubscribe independently", () => {
    const subs = Subscribers<unknown>();
    let changes = 0;
    let dones = 0;
    let transitions = 0;
    let errors = 0;
    const offChange = subs.addChange(() => changes++);
    const offDone = subs.addDone(() => dones++);
    const offTransition = subs.addTransition(() => transitions++);
    const offError = subs.addError(() => errors++);
    const snap = { path: ["idle"], context: {}, regions: {} };
    const info: ErrorInfo = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect",
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

  test("addError sets the last stored snapshot error for late subscribers", () => {
    const subs = Subscribers<unknown>();
    const info: ErrorInfo = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect",
    };
    subs.seed({ path: ["__error"], context: {}, regions: {}, error: info });
    const seen: unknown[] = [];
    subs.addError((e) => seen.push(e));
    expect(seen).toEqual([info]);
  });

  test("error subscriber throws are contained and other error subscribers still run", () => {
    const subs = Subscribers<unknown>();
    const info: ErrorInfo = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect",
    };
    const seen: unknown[] = [];
    subs.addError(() => isErrorBomb("sub boom"));
    subs.addError((e) => seen.push(e));
    expect(() => subs.emitError(info)).not.toThrow();
    expect(seen).toEqual([info]);
  });

  test("clear removes error subscribers", () => {
    const subs = Subscribers<unknown>();
    const info: ErrorInfo = {
      error: new Error("boom"),
      state: state("idle")(),
      context: {},
      event: { type: "X" },
      reason: "effect",
    };
    let errors = 0;
    subs.addError(() => errors++);
    subs.clear();
    subs.emitError(info);
    expect(errors).toBe(0);
  });

  test("the actor calls output subscribers for every event and lets them unsubscribe independently", () => {
    const subs = Subscribers<unknown>();
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
    const subs = Subscribers<unknown>();
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
      context: Context({ get: () => ({}), set: () => {} }),
      emit: () => {},
      clock: VirtualClock(),
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
      onError: (error) => {
        expect(errorMessage(error)).toBe("boom");
      },
    });
    expect(seen).toEqual(["one"]);
    expect(result.ran).toEqual(["pushOne"]);
  });

  test("the actor calls onError with an async rejection", async () => {
    const seen: string[] = [];
    const result = runEffects({
      ...baseOptions(),
      effects: {
        idle: [
          {
            name: "lateThrow",
            fn: async () => isErrorBomb("late boom"),
          },
        ],
      },
      onError: (error) => {
        seen.push(errorMessage(error));
      },
    });
    await Promise.all(result.pending);
    expect(seen).toEqual(["late boom"]);
  });

  test("the actor ignores a rejection caused by abort", async () => {
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
              await new Promise<void>((...executorArgs) => {
                const reject = executorArgs[1];
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

  test("runEffects skips effects once the run is already aborted", () => {
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

  test("runEffects calls effects with the entered state payload and event", () => {
    const seen: string[] = [];
    runEffects({
      ...baseOptions(),
      statePayload: { x: 5 },
      effects: {
        idle: [
          {
            name: "recordPayloadAndEvent",
            fn: ({ state, event }) => {
              const payload = state.payload;
              const x =
                typeof payload === "object" && payload !== null && "x" in payload
                  ? payload.x
                  : undefined;
              seen.push(`${state.name}:${String(x)}:${event.type}`);
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
