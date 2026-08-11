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
    setOutputHandler(actor, (e) => received.push(e.type));
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT"]);
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

describe("Actor context change detection", () => {
  test("context.set without a transition emits change", () => {
    const idle = state("idle")();
    const reset = event("RESET_PROGRESS")();
    const actor = new Actor({
      inputs: [reset],
      states: [idle],
      initial: idle,
      context: { progress: 1 },
      setup: (m) => {
        m.on(idle, reset, (_e, { context }) => {
          context.set({ progress: 0 });
          return {};
        });
      },
    });
    const seen: number[] = [];
    actor.on("change", (snap) => seen.push(snap.context.progress));
    actor.send(reset.create());
    expect(seen).toEqual([1, 0]);
  });

  test("prev snapshot discriminates state vs context change", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [go, tick],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.onAny(tick, (_e, { context }) => {
          context.set({ n: 5 });
          return {};
        });
      },
    });
    const kinds: string[] = [];
    actor.on("change", (snap, prev) => {
      const stateChanged = snap.path[0] !== prev.path[0];
      const contextChanged = snap.context !== prev.context;
      kinds.push(`${stateChanged ? "state" : ""}${contextChanged ? "context" : ""}`);
    });
    actor.send(go.create());
    actor.send(tick.create());
    expect(kinds[0]).toBe(""); // subscribe ping: current vs current
    expect(kinds[1]).toBe("state");
    expect(kinds[2]).toBe("context");
  });

  test("set plus transition in one handler emits a single coalesced change", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, go, (_e, { context }) => {
          const s = context.get();
          context.set({ ...s, n: 1 });
          return { state: active };
        });
      },
    });
    let calls = 0;
    actor.on("change", () => calls++);
    actor.send(go.create());
    expect(calls).toBe(2); // subscribe ping + one end-of-dispatch emit
  });

  test("snapshot().context is the current context reference", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { n: 1 },
      setup: (m) => {
        m.on(idle, tick, (_e, { context }) => {
          const s = context.get();
          context.set({ ...s, n: 2 });
          return {};
        });
      },
    });
    expect(actor.snapshot().context).toEqual({ n: 1 });
    actor.send(tick.create());
    expect(actor.snapshot().context).toEqual({ n: 2 });
  });

  test("set with the same reference after in-place mutation emits change", () => {
    class MutableProgress {
      progress = 1;
    }
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: new MutableProgress(),
      setup: (m) => {
        m.on(idle, tick, (_e, { context }) => {
          const c = context.get() as MutableProgress;
          c.progress += 1;
          context.set(c); // same reference — the write itself is the signal
          return {};
        });
      },
    });
    const seen: number[] = [];
    actor.on("change", (snap) => seen.push((snap.context as MutableProgress).progress));
    actor.send(tick.create());
    expect(seen).toEqual([1, 2]);
  });
});
