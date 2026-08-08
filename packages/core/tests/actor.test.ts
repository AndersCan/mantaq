import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event } from "../src/index.ts";
import { setOutputHandler } from "../src/internal-registry.ts";

describe("Actor dispatch resolution", () => {
  test("state handler wins over Any handler for same event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    let anyRuns = 0;

    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.onAny(go, () => {
          anyRuns++;
          return { state: idle };
        });
      },
    });

    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(anyRuns).toBe(1);
  });

  test("Any handler can emit without transitioning", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const out = event("OUT")();

    const actor = new Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny(tick, () => ({ emit: [out.create()] }));
      },
    });

    const received: string[] = [];
    setOutputHandler(actor, (e) => received.push(e.id));
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT"]);
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

  test("send is ignored once in a final state", () => {
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

    let doneCalls = 0;
    actor.on("done", () => doneCalls++);
    actor.send(finish.create());
    actor.send(finish.create());
    expect(actor.snapshot().done).toBe(true);
    expect(doneCalls).toBe(1);
  });
});

describe("Actor effects", () => {
  test("transition aborts the running effect", () => {
    const idle = state("idle")();
    const running = state("running")();
    const go = event("GO")();
    const stop = event("STOP")();
    let effectSignal: AbortSignal | undefined;

    const actor = new Actor({
      inputs: [go, stop],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, ({ signal }) => {
          effectSignal = signal;
        });
        m.on(idle, go, () => ({ state: running }));
        m.on(running, stop, () => ({ state: idle }));
      },
    });

    actor.send(go.create());
    expect(effectSignal?.aborted).toBe(false);
    actor.send(stop.create());
    expect(effectSignal?.aborted).toBe(true);
  });

  test("state payload flows to the effect", () => {
    const idle = state("idle")();
    const running = state("running")<{ url: string }>();
    const go = event("GO")();
    let payload: unknown;

    const actor = new Actor({
      inputs: [go],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, ({ state }) => {
          payload = state.payload;
        });
        m.on(idle, go, () => ({ state: running.create({ url: "https://x" }) }));
      },
    });

    actor.send(go.create());
    expect(payload).toEqual({ url: "https://x" });
  });
});

describe("Actor internal budget", () => {
  test("emit loop halts after budget and warns", () => {
    const idle = state("idle")();
    const start = event("START")();
    const loop = event("LOOP")();

    const actor = new Actor({
      inputs: [start],
      outputs: [loop],
      internal: [loop],
      states: [idle],
      initial: idle,
      internalBudget: 2,
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
});

describe("Actor regions", () => {
  test("child output routes to parent queue as input", () => {
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
});
