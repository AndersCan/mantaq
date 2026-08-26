import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/index.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import type { AnyStateRef } from "../src/state.ts";
import type { ErrorInfo } from "../src/actor-types.ts";
import type { Snapshot } from "../src/index.ts";

describe("Actor error paths", () => {
  test("initial state not declared throws with the full state list", () => {
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

  test("send is ignored entirely once final", () => {
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

  test("unhandled output without a handler does not throw", () => {
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
  });

  test("unhandled external event is ignored silently", () => {
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

  test("emit loop halts after the internal budget is consumed", () => {
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
      internalBudget: 2,
      setup: (m) => {
        m.on(idle, start, () => ({ emit: [loop.create()] }));
        m.on(idle, loop, () => {
          handlerCalls++;
          return { emit: [loop.create()] };
        });
      },
    });
    actor.send(start.create());
    expect(handlerCalls).toBe(2);
    expect(actor.snapshot().error?.reason).toBe("budget");
  });

  test("budget exhaustion aborts the running effect", () => {
    const idle = state("idle")();
    const running = state("running")();
    const start = event("START")();
    const loop = event("LOOP")();
    let effectSignal: AbortSignal | undefined;
    const clock = new VirtualClock();
    const actor = new Actor({
      clock,
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle, running],
      initial: idle,
      internalBudget: 2,
      setup: (m) => {
        m.on(idle, start, () => ({ state: running }));
        m.effect(running, {
          name: "captureSignal",
          fn: ({ signal }) => {
            effectSignal = signal;
          },
        });
        m.on(running, loop, () => ({ emit: [loop.create()] }));
      },
    });
    actor.send(start.create());
    expect(effectSignal?.aborted).toBe(false);
    actor.inject(loop.create());
    clock.advance(1);
    expect(effectSignal?.aborted).toBe(true);
  });

  test("the issue repro: a throwing effect never escapes send and the machine dies", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const done = state("done")();
    const start = event("START")();
    const finish = event("FINISH")();
    let effectRuns = 0;
    const actor = new Actor({
      inputs: [start],
      outputs: [finish],
      internal: [finish],
      states: [idle, loading, done],
      initial: idle,
      setup: (m) => {
        m.on(idle, start, () => ({ state: loading, emit: [finish.create(), finish.create()] }));
        m.effect(loading, {
          name: "throwEffectBug",
          fn: () => {
            effectRuns++;
            throw new Error("effect bug");
          },
        });
        m.on(loading, finish, () => ({ state: done }));
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
    expect(() => actor.send(go.create())).not.toThrow();
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
    expect(() => actor.send(go.create())).not.toThrow();
    const snap = actor.snapshot();
    expect(snap).toMatchObject({
      path: ["__error"],
      error: { reason: "effect", state: { name: "loading" }, event: { type: "GO" } },
    });
  });

  test("error context is the context from before the bad event", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, go, (_e, { context }) => {
          context.set({ n: 99 });
          throw new Error("boom");
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().error?.context).toEqual({ n: 0 });
  });

  test("a throwing subscriber is contained and the machine survives", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const seen: string[] = [];
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    actor.on("change", () => {
      throw new Error("sub boom");
    });
    actor.on("change", (snap) => seen.push(snap.path[0]));
    expect(() => actor.send(go.create())).not.toThrow();
    expect(actor.snapshot().path[0]).toBe("active");
    expect(actor.snapshot().error).toBeUndefined();
    expect(seen).toContain("active");
  });

  test("a throwing output handler routes to the error state", () => {
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
    expect(actor.snapshot()?.error?.event.type).toBe("OUT");
  });

  test("an invalid transition target routes to the error state", () => {
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

  test("an async effect rejection routes to the error state", async () => {
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
    expect(() => actor.send(go.create())).not.toThrow();
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

  test("throwing handlers converge regardless of delivery path", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const bad = event("BAD")();
    const make = () =>
      new Actor({
        inputs: [go, bad],
        states: [idle, active],
        initial: idle,
        setup: (m) => {
          m.on(idle, go, () => ({ state: active }));
          m.on(active, bad, () => {
            throw new Error("boom");
          });
        },
      });
    const norm = (s: Snapshot) => ({
      path: s.path,
      reason: s.error?.reason,
      event: s?.error?.event.type,
      state: s.error?.state.name,
    });

    const a = make();
    const aChanges: Array<{ path: string[]; error?: string }> = [];
    a.on("change", (s) => aChanges.push({ path: s.path, error: s.error ? "error" : "ok" }));
    expect(() => a.send(go.create())).not.toThrow();
    expect(() => a.send(bad.create())).not.toThrow();

    const b = make();
    const bChanges: Array<{ path: string[]; error?: string }> = [];
    let sent = false;
    b.on("change", (s) => {
      bChanges.push({ path: s.path, error: s.error ? "error" : "ok" });
      if (s.path[0] === "active" && !sent) {
        sent = true;
        b.send(bad.create());
      }
    });
    expect(() => b.send(go.create())).not.toThrow();

    expect(aChanges).toEqual(bChanges);
    expect(norm(a.snapshot())).toEqual(norm(b.snapshot()));
  });

  test("recover resumes a dead machine from the caller-supplied state and context", () => {
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
    expect(() => actor.send(tick.create())).not.toThrow();
    expect(ticks).toBe(0);

    actor.recover({ state: loading, context: { n: 7 } });
    expect(actor.snapshot().error).toBeUndefined();
    expect(actor.snapshot().path[0]).toBe("loading");
    expect(actor.context).toEqual({ n: 7 });
    // The recovered context must be handed out by the copy-on-read snapshot API
    // (issue #269): `recover` invalidates the cached snapshot clone
    // (`#contextDirty = true`, `#deliveredContext = null`) before emitting, so a
    // subscriber reading `snapshot().context` sees { n: 7 }, not the pre-error
    // cached context.
    expect(actor.snapshot().context).toEqual({ n: 7 });
    actor.send(tick.create());
    expect(ticks).toBe(1);
    expect(actor.snapshot().path[0]).toBe("idle");
  });

  test("construction-time unhandled internal event reaches a late on('error') subscriber", () => {
    const idle = state("idle")();
    const probe = event("PROBE")();
    const actor = new Actor({
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
    actor.on("error", (info) => seen.push(info));
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
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "throwOnInit",
          fn: () => {
            throw new Error("init boom");
          },
        });
      },
    });
    const seen: ErrorInfo[] = [];
    actor.on("error", (info) => seen.push(info));
    expect(seen).toMatchObject([
      {
        reason: "effect",
        event: { type: "__init" },
        error: expect.objectContaining({ message: "init boom" }),
      },
    ]);
  });

  test("runtime death fires a pre-attached on('error') subscriber", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const seen: ErrorInfo[] = [];
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
    actor.on("error", (info) => seen.push(info));
    actor.send(go.create());
    expect(seen).toMatchObject([{ reason: "effect", state: { name: "active" } }]);
    expect(actor.snapshot().error?.reason).toBe("effect");
  });

  test("recover clears stored error so late subscribers get no stale delivery", () => {
    const idle = state("idle")();
    const go = event("GO")();
    const tick = event("TICK")();
    let ticks = 0;
    const actor = new Actor({
      inputs: [go, tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("boom");
        });
        m.on(idle, tick, () => {
          ticks++;
          return {};
        });
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().error?.reason).toBe("transition");
    const before: ErrorInfo[] = [];
    actor.on("error", (info) => before.push(info));
    expect(before.length).toBe(1);

    actor.recover({ state: idle, context: {} });
    const after: ErrorInfo[] = [];
    actor.on("error", (info) => after.push(info));
    expect(after.length).toBe(0);
    actor.send(tick.create());
    expect(ticks).toBe(1);
    expect(after.length).toBe(0);
  });

  test("on('error') unsubscribe stops further delivery", () => {
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
    const seen: ErrorInfo[] = [];
    const off = actor.on("error", (info) => seen.push(info));
    actor.send(go.create());
    expect(seen.length).toBe(1);
    off();
    actor.recover({ state: idle, context: {} });
    actor.send(go.create());
    expect(seen.length).toBe(1);
  });
});
