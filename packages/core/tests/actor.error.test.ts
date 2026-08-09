import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/index.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";
import { pushInternal } from "../src/internal-registry.ts";
import type { AnyActor } from "../src/actor-internal.ts";
import type { AnyStateRef } from "../src/state.ts";

describe("Actor error paths", () => {
  test("initial state warning lists undeclared and declared states", () => {
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

  test("unregistered region child logs a registry error", () => {
    const idle = state("idle")();
    const stub: AnyActor = {
      state: state("s")(),
      clock: new VirtualClock(),
      regions: {},
      send: () => {},
      snapshot: () => ({ path: ["s"], regions: {} }),
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

  test("unhandled event warns and is dropped", () => {
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
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
      actor.send(start.create());
    } finally {
      console.warn = original;
    }
    expect(handlerCalls).toBe(2);
    expect(warns.some((w) => w.includes("budget"))).toBe(true);
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
        m.effect(running, ({ signal }) => {
          effectSignal = signal;
        });
        m.on(running, loop, () => ({ emit: [loop.create()] }));
      },
    });
    actor.send(start.create());
    expect(effectSignal?.aborted).toBe(false);
    pushInternal(actor, loop.create());
    clock.advance(1);
    expect(effectSignal?.aborted).toBe(true);
  });
});
