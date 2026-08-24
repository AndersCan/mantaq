import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event, VirtualClock } from "../src/index.ts";

describe("Actor.settled", () => {
  test("settled waits for async effects spawned by other effects", async () => {
    const idle = state("idle")();
    const a = state("a")();
    const b = state("b")();
    const go = event("GO")();
    const next = event("NEXT")();
    const clock = new VirtualClock();
    let bEffectRan = false;

    const actor = new Actor({
      clock,
      inputs: [go],
      internal: [next],
      states: [idle, a, b],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: a }));
        m.effect(a, ({ emit }) => Promise.resolve().then(() => emit(next.create())));
        m.on(a, next, () => ({ state: b }));
        m.effect(b, () =>
          Promise.resolve().then(() => {
            bEffectRan = true;
          }),
        );
      },
    });

    actor.send(go.create());
    await actor.settled();
    expect(bEffectRan).toBe(true);
    expect(actor.state.name).toBe("b");
  });
});

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
    actor.on("output", (e) => received.push(e.type));
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
  test("initial state effects run at construction", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const clock = new VirtualClock();
    let effectRuns = 0;
    const actor = new Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, ({ event, emit }) => {
          effectRuns++;
          expect(event.type).toBe("__init");
          emit(tick.create());
        });
        m.on(idle, tick, () => ({ state: done }));
      },
    });
    expect(effectRuns).toBe(1);
    expect(actor.snapshot().path[0]).toBe("done");
    expect(actor.snapshot().done).toBe(true);
  });

  test("initial state effects arm timers deterministically", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const clock = new VirtualClock();
    const actor = new Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, ({ emit }) => {
          clock.setTimeout(500, () => emit(tick.create()), {
            signal: new AbortController().signal,
          });
        });
        m.on(idle, tick, () => ({ state: done }));
      },
    });
    expect(actor.snapshot().path[0]).toBe("idle");
    clock.advance(499);
    expect(actor.snapshot().path[0]).toBe("idle");
    clock.advance(1);
    expect(actor.snapshot().path[0]).toBe("done");
    expect(clock.hasPending()).toBe(false);
  });

  test("effects run on final state entry", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let finalEffectRuns = 0;
    const actor = new Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, finish, () => ({ state: done }));
        m.effect(done, () => {
          finalEffectRuns++;
        });
      },
    });
    actor.send(finish.create());
    expect(finalEffectRuns).toBe(1);
    expect(actor.snapshot().done).toBe(true);
  });

  test("final state effects can emit outputs to a parent", () => {
    const childIdle = state("cidle")();
    const childDone = state("cdone")().final();
    const childGo = event("CGO")();
    const childOut = event("COUT")();
    const parentIdle = state("pidle")();
    const parentActive = state("pactive")();

    const child = new Actor({
      inputs: [childGo],
      outputs: [childOut],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, childGo, () => ({ state: childDone }));
        m.effect(childDone, ({ emit }) => emit(childOut.create()));
      },
    });

    const parent = new Actor({
      inputs: [childOut],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, childOut, () => ({ state: parentActive }));
      },
    });

    child.send(childGo.create());
    expect(child.snapshot().done).toBe(true);
    expect(parent.snapshot().path[0]).toBe("pactive");
  });

  test("emit after abort is a silent no-op", () => {
    const idle = state("idle")();
    const running = state("running")();
    const go = event("GO")();
    const stop = event("STOP")();
    const out = event("OUT")();
    const received: string[] = [];
    let savedEmit: ((e: { type: string; payload?: unknown }) => void) | undefined;
    const actor = new Actor({
      inputs: [go, stop],
      outputs: [out],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, ({ emit }) => {
          savedEmit = emit;
        });
        m.on(idle, go, () => ({ state: running }));
        m.on(running, stop, () => ({ state: idle }));
      },
    });
    actor.on("output", (e) => received.push(e.type));
    actor.send(go.create());
    expect(savedEmit).toBeDefined();
    actor.send(stop.create());
    savedEmit!(out.create());
    expect(received).toEqual([]);
  });

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

  test("dispose cascades to region child actors", () => {
    const childClock = new VirtualClock();
    const cIdle = state("cidle")();
    const parentIdle = state("pidle")();

    const child = new Actor({
      inputs: [],
      states: [cIdle],
      initial: cIdle,
      clock: childClock,
      setup: (m) => {
        m.effect(cIdle, (input) => {
          input.clock.setInterval(10, () => {}, { signal: input.signal });
        });
      },
    });

    const parent = new Actor({
      inputs: [],
      states: [parentIdle],
      initial: parentIdle,
      regions: { child },
      setup: () => {},
    });

    expect(childClock.hasPending()).toBe(true);

    parent.dispose();

    expect(childClock.hasPending()).toBe(false);
    child.send(cIdle.name as never);
    expect(child.snapshot().path[0]).toBe("cidle");
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

describe("Actor payload normalization", () => {
  test("a payload-less event reaching a payload-reading handler gets an empty payload", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    const actor = new Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, update, (e) => {
          void e.payload.codeSize;
          return {};
        });
      },
    });
    const wide: { send(event: { type: string; payload?: unknown }): void } = actor;
    wide.send({ type: "UPDATE" });
    expect(actor.snapshot().error).toBeUndefined();
    expect(actor.state.name).toBe("idle");
  });

  test("the payload is preserved when present", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    let seen: unknown;
    const actor = new Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, update, (e) => {
          seen = e.payload;
          return {};
        });
      },
    });
    actor.send(update.create({ codeSize: 3 }));
    expect(seen).toEqual({ codeSize: 3 });
  });
});

describe("Actor snapshot payload", () => {
  test("snapshot exposes the payload of the current state", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: ready.create({ items: ["a"] }) }));
      },
    });
    expect(actor.snapshot().payload).toBeUndefined();
    actor.send(go.create());
    expect(actor.snapshot().payload).toEqual({ items: ["a"] });
  });

  test("an initial state with a payload is observable from the start", () => {
    const ready = state("ready")<{ items: string[] }>();
    const actor = new Actor({
      inputs: [],
      states: [ready],
      initial: ready.create({ items: ["a"] }),
      setup: () => {},
    });
    expect(actor.snapshot().path[0]).toBe("ready");
    expect(actor.snapshot().payload).toEqual({ items: ["a"] });
  });

  test("a state entered without a payload has no snapshot payload", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: ready }));
      },
    });
    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("ready");
    expect(actor.snapshot().payload).toBeUndefined();
  });
});

describe("Actor transition observability", () => {
  test("transition hook reports every handled event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", (info) =>
      seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    );
    actor.send(go.create());
    expect(seen).toEqual([{ from: "idle", to: "active", transitioned: true }]);
  });

  test("transition hook reports self-transitions as transitioned", () => {
    const home = state("home")();
    const reset = event("RESET")();
    const actor = new Actor({
      inputs: [reset],
      states: [home],
      initial: home,
      setup: (m) => {
        m.on(home, reset, () => ({ state: home }));
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", (info) =>
      seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    );
    actor.send(reset.create());
    expect(seen).toEqual([{ from: "home", to: "home", transitioned: true }]);
  });

  test("transition hook reports no-op handlers as not transitioned", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny(tick, () => ({}));
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", (info) =>
      seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    );
    actor.send(tick.create());
    expect(seen).toEqual([{ from: "idle", to: "idle", transitioned: false }]);
  });

  test("transition hook reports an onAny handler that transitions", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny(go, () => ({ state: active }));
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", (info) =>
      seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    );
    actor.send(go.create());
    expect(seen).toEqual([{ from: "idle", to: "active", transitioned: true }]);
  });

  test("cascaded events each fire their own transition hook", () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const start = event("START")();
    const next = event("NEXT")();
    const actor = new Actor({
      inputs: [start],
      internal: [next],
      states: [a, b, c],
      initial: a,
      setup: (m) => {
        m.on(a, start, () => ({ state: b }));
        m.effect(b, ({ emit }) => emit(next.create()));
        m.on(b, next, () => ({ state: c }));
      },
    });
    const seen: Array<{ from: string; to: string }> = [];
    actor.on("transition", (info) => seen.push({ from: info.from, to: info.to }));
    actor.send(start.create());
    expect(new Set(seen.map((s) => `${s.from}->${s.to}`))).toEqual(new Set(["a->b", "b->c"]));
  });
});
