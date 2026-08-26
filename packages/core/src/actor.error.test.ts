// eslint-disable-next-line oxlinter/files-kebab-case
import type { Snapshot } from "./actor-internal.ts";
import type { ErrorInfo } from "./actor-types.ts";
import { event } from "./event.ts";
import { Actor, VirtualClock } from "./index.ts";
import { type AnyStateRef, type StateRef, state } from "./state.ts";
import { expect, test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 */
function isErrorBomb(message: string): never {
  throw new Error(message);
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

describe("Actor error paths", () => {
  test("initial state not declared throws with the full state list", () => {
    const a = state("a")();
    const b = state("b")();
    const stray = state("stray")();
    const declared: AnyStateRef[] = [a, b];
    function buildWithStrayInitial() {
      return Actor<AnyStateRef[], [], [], [], Record<string, unknown>>({
        inputs: [],
        states: declared,
        initial: stray,
        setup: () => {},
      });
    }
    expect(buildWithStrayInitial).toThrow(/stray/);
    expect(buildWithStrayInitial).toThrow(/a, b/);
  });

  test("the machine ignores sends entirely once final", () => {
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

  test("unhandled output without a handler does not throw", () => {
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
  });

  test("the machine silently ignores an unhandled external event", () => {
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

  test("emit loop halts after the internal budget is consumed", () => {
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
      internalBudget: 2,
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
    expect(handlerCalls).toBe(2);
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("the actor fails the running effect when the budget is exhausted", () => {
    const idle = state("idle")();
    const running = state("running")();
    const start = event("START")();
    const loop = event("LOOP")();
    let effectSignal: AbortSignal | undefined;
    const clock = VirtualClock();
    const actor = Actor({
      clock,
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle, running],
      initial: idle,
      internalBudget: 2,
      setup: (m) => {
        m.on(idle, { eventRef: start, handler: () => ({ state: running }) });
        m.effect(running, {
          name: "captureSignal",
          fn: ({ signal }) => {
            effectSignal = signal;
          },
        });
        m.on(running, { eventRef: loop, handler: () => ({ emit: [loop.create()] }) });
      },
    });
    actor.send(start.create());
    const abortedBefore = effectSignal?.aborted;
    actor.inject(loop.create());
    clock.advance(1);
    expect([abortedBefore, effectSignal?.aborted]).toEqual([false, true]);
  });

  test("the issue repro: a throwing effect never escapes send and the machine dies", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const done = state("done")();
    const start = event("START")();
    const finish = event("FINISH")();
    let effectRuns = 0;
    const actor = Actor({
      inputs: [start],
      outputs: [finish],
      internal: [finish],
      states: [idle, loading, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: start,
          handler: () => ({ state: loading, emit: [finish.create(), finish.create()] }),
        });
        m.effect(loading, {
          name: "throwEffectBug",
          fn: () => {
            effectRuns++;
            return isErrorBomb("effect bug");
          },
        });
        m.on(loading, { eventRef: finish, handler: () => ({ state: done }) });
      },
    });
    expect(() => actor.send(start.create())).not.toThrow();
    expect(effectRuns).toBe(1);
    const snap = actor.snapshot();
    expect(snap).toMatchObject({
      path: ["__error"],
      error: {
        reason: "effect",
        state: { name: "loading" },
        event: { type: "START" },
        error: expect.objectContaining({ message: "effect bug" }),
      },
    });
  });

  test("a throwing transition handler routes to the error state and never resurrects", () => {
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
    expect(() => actor.send(trigger.create())).not.toThrow();
    const snap = actor.snapshot();
    expect(snap).toMatchObject({
      path: ["__error"],
      done: true,
      error: { reason: "transition", event: { type: "GO" }, state: { name: "idle" } },
    });
    expect(ranAny).toBe(false);
  });

  test("a throwing effect records the state being entered (post-step pin)", () => {
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
    expect(() => actor.send(trigger.create())).not.toThrow();
    const snap = actor.snapshot();
    expect(snap).toMatchObject({
      path: ["__error"],
      error: { reason: "effect", state: { name: "loading" }, event: { type: "GO" } },
    });
  });

  test("the error snapshot keeps the context from before the bad event", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: (_e, { context }) => {
            context.set({ n: 99 });
            return isErrorBomb("boom");
          },
        });
      },
    });
    actor.send(trigger.create());
    expect(actor.snapshot().error?.context).toEqual({ n: 0 });
  });

  test("a throwing subscriber is contained and the machine survives", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const seen: string[] = [];
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    actor.on("change", { fn: () => isErrorBomb("sub boom") });
    actor.on("change", { fn: (snap) => seen.push(snap.path[0]) });
    expect(() => actor.send(trigger.create())).not.toThrow();
    const snapAfterCrash = actor.snapshot();
    expect({
      state: snapAfterCrash.path[0],
      error: snapAfterCrash.error,
      seenHasActive: seen.includes("active"),
    }).toEqual({ state: "active", error: undefined, seenHasActive: true });
  });

  test("a throwing output handler routes to the error state", () => {
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
    const outputDeathSnap = actor.snapshot();
    expect({
      reason: outputDeathSnap.error?.reason,
      eventType: outputDeathSnap.error?.event.type,
    }).toEqual({ reason: "output", eventType: "OUT" });
  });

  test("the machine handles an invalid transition target by entering the error state", () => {
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

  test("the machine handles an async effect rejection by entering the error state", async () => {
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
    expect(() => actor.send(trigger.create())).not.toThrow();
    await actor.settled();
    const snap = actor.snapshot();
    expect(snap).toMatchObject({
      path: ["__error"],
      error: {
        reason: "effect",
        state: { name: "loading" },
        error: expect.objectContaining({ message: "late boom" }),
      },
    });
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

  test("throwing handlers converge regardless of delivery path", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const bad = event("BAD")();
    function make() {
      return Actor({
        inputs: [trigger, bad],
        states: [idle, active],
        initial: idle,
        setup: (m) => {
          m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
          m.on(active, { eventRef: bad, handler: () => isErrorBomb("boom") });
        },
      });
    }
    function norm(snapshotArg: Snapshot) {
      return {
        path: snapshotArg.path,
        reason: snapshotArg.error?.reason,
        eventType: snapshotArg.error?.event.type,
        state: snapshotArg.error?.state.name,
      };
    }

    const a = make();
    const aChanges: Array<{ path: string[]; error?: string }> = [];
    a.on("change", { fn: (s) => aChanges.push({ path: s.path, error: s.error ? "error" : "ok" }) });
    expect(() => a.send(trigger.create())).not.toThrow();
    expect(() => a.send(bad.create())).not.toThrow();

    const b = make();
    const bChanges: Array<{ path: string[]; error?: string }> = [];
    let sent = false;
    b.on("change", {
      fn: (s) => {
        bChanges.push({ path: s.path, error: s.error ? "error" : "ok" });
        if (s.path[0] === "active" && !sent) {
          sent = true;
          b.send(bad.create());
        }
      },
    });
    expect(() => b.send(trigger.create())).not.toThrow();

    expect(aChanges).toEqual(bChanges);
    expect(norm(a.snapshot())).toEqual(norm(b.snapshot()));
  });

  test("recover sets a dead machine back to the caller-supplied state and context", () => {
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
    const effectDeathReason = actor.snapshot().error?.reason;
    expect(effectDeathReason).toBe("effect");
    expect(() => actor.send(tick.create())).not.toThrow();
    expect(ticks).toBe(0);

    actor.recover({ state: loading, context: { n: 7 } });
    const recoveredSnap = actor.snapshot();
    expect({
      error: recoveredSnap.error,
      state: recoveredSnap.path[0],
      context: actor.context,
    }).toEqual({
      error: undefined,
      state: "loading",
      context: { n: 7 },
    });
    // The recovered context must be handed out by the copy-on-read snapshot API
    // (issue #269): `recover` invalidates the cached snapshot clone
    // (`#contextDirty = true`, `#deliveredContext = null`) before emitting, so a
    // subscriber reading `snapshot().context` sees { n: 7 }, not the pre-error
    // cached context.
    expect(actor.snapshot().context).toEqual({ n: 7 });
    actor.send(tick.create());
    expect(ticks).toBe(1);
    const finalState = actor.snapshot().path[0];
    expect(finalState).toBe("idle");
  });

  test("the actor calls a late on('error') subscriber for a construction-time unhandled internal event", () => {
    const idle = state("idle")();
    const probe = event("PROBE")();
    const actor = Actor({
      inputs: [],
      outputs: [probe],
      internal: [probe],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "emitProbe",
          fn: ({ emit }) => {
            emit(probe.create());
          },
        });
      },
    });
    expect(actor.snapshot().path[0]).toBe("__error");
    const seen: ErrorInfo[] = [];
    actor.on("error", { fn: (info) => seen.push(info) });
    expect(seen).toMatchObject([
      {
        reason: "unhandled",
        state: { name: "idle" },
        event: { type: "PROBE" },
        error: expect.any(Error),
      },
    ]);
  });

  test("construction-time throwing initial effect also signals late on('error') subscribers", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "throwOnInit",
          fn: () => isErrorBomb("init boom"),
        });
      },
    });
    const seen: ErrorInfo[] = [];
    actor.on("error", { fn: (info) => seen.push(info) });
    expect(seen).toMatchObject([
      {
        reason: "effect",
        event: { type: "__init" },
        error: expect.objectContaining({ message: "init boom" }),
      },
    ]);
  });

  test("runtime death calls a pre-attached on('error') subscriber", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const seen: ErrorInfo[] = [];
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
    actor.on("error", { fn: (info) => seen.push(info) });
    actor.send(trigger.create());
    expect(seen).toMatchObject([{ reason: "effect", state: { name: "active" } }]);
    expect(actor.snapshot().error?.reason).toBe("effect");
  });

  test("recover deletes the stored error so late subscribers get no stale delivery", () => {
    const idle = state("idle")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    let ticks = 0;
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => isErrorBomb("boom") });
        m.on(idle, {
          eventRef: tick,
          handler: () => {
            ticks++;
            return {};
          },
        });
      },
    });
    actor.send(trigger.create());
    const transitionDeathReason = actor.snapshot().error?.reason;
    expect(transitionDeathReason).toBe("transition");
    const before: ErrorInfo[] = [];
    actor.on("error", { fn: (info) => before.push(info) });
    expect(before).toHaveLength(1);

    actor.recover({ state: idle, context: {} });
    const after: ErrorInfo[] = [];
    actor.on("error", { fn: (info) => after.push(info) });
    expect(after).toHaveLength(0);
    actor.send(tick.create());
    expect(ticks).toBe(1);
    expect(after).toHaveLength(0);
  });

  test("on('error') unsubscribe skips further delivery", () => {
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
    const seen: ErrorInfo[] = [];
    const off = actor.on("error", { fn: (info) => seen.push(info) });
    actor.send(trigger.create());
    expect(seen).toHaveLength(1);
    off();
    actor.recover({ state: idle, context: {} });
    actor.send(trigger.create());
    expect(seen).toHaveLength(1);
  });
});
