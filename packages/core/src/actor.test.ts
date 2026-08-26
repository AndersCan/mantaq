import { Actor, state, event, VirtualClock } from "./index.ts";
import { expect, test, describe } from "vite-plus/test";

describe("Actor.settled", () => {
  test("settled resolves only after async effects spawned by other effects", async () => {
    const idle = state("idle")();
    const a = state("a")();
    const b = state("b")();
    const trigger = event("GO")();
    const next = event("NEXT")();
    const clock = VirtualClock();
    let bEffectRan = false;

    const actor = Actor({
      clock,
      inputs: [trigger],
      internal: [next],
      states: [idle, a, b],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: a }) });
        m.effect(a, {
          name: "chainToNext",
          fn: ({ emit }) => Promise.resolve().then(() => emit(next.create())),
        });
        m.on(a, { eventRef: next, handler: () => ({ state: b }) });
        m.effect(b, {
          name: "flagArrival",
          fn: () =>
            Promise.resolve().then(() => {
              bEffectRan = true;
            }),
        });
      },
    });

    actor.send(trigger.create());
    await actor.settled();
    expect(bEffectRan).toBe(true);
    expect(actor.state.name).toBe("b");
  });
});

describe("Actor dispatch resolution", () => {
  test("the machine treats the state handler as higher priority than the Any handler for the same event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    let anyRuns = 0;

    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({
          eventRef: trigger,
          handler: () => {
            anyRuns++;
            return { state: idle };
          },
        });
      },
    });

    actor.send(trigger.create());
    expect(actor.snapshot().path[0]).toBe("active");
    expect(anyRuns).toBe(1);
  });

  test("Any handler can emit without transitioning", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const out = event("OUT")();

    const actor = Actor({
      inputs: [tick],
      outputs: [out],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: tick, handler: () => ({ emit: [out.create()] }) });
      },
    });

    const received: string[] = [];
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(tick.create());
    expect(actor.snapshot().path[0]).toBe("idle");
    expect(received).toEqual(["OUT"]);
  });

  test("the actor ignores sends once in a final state", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();

    const actor = Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
      },
    });

    let doneCalls = 0;
    actor.on("done", { fn: () => doneCalls++ });
    actor.send(finish.create());
    actor.send(finish.create());
    expect(actor.snapshot().done).toBe(true);
    expect(doneCalls).toBe(1);
  });
});

describe("Actor effects", () => {
  test("the actor calls initial state effects at construction", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const clock = VirtualClock();
    let effectRuns = 0;
    const actor = Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "tickOnInit",
          fn: ({ event, emit }) => {
            effectRuns++;
            expect(event.type).toBe("__init");
            emit(tick.create());
          },
        });
        m.on(idle, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    const doneSnap = actor.snapshot();
    expect({ runs: effectRuns, state: doneSnap.path[0], done: doneSnap.done }).toEqual({
      runs: 1,
      state: "done",
      done: true,
    });
  });

  test("initial state effects set timers deterministically", () => {
    const idle = state("idle")();
    const done = state("done")().final();
    const tick = event("TICK")();
    const clock = VirtualClock();
    const actor = Actor({
      clock,
      inputs: [],
      internal: [tick],
      states: [idle, done],
      initial: idle,
      setup: (m) => {
        m.effect(idle, {
          name: "armTickTimer",
          fn: ({ emit }) => {
            clock.setTimeout(500, {
              cb: () => emit(tick.create()),
              signal: new AbortController().signal,
            });
          },
        });
        m.on(idle, { eventRef: tick, handler: () => ({ state: done }) });
      },
    });
    const statesAt = [actor.snapshot().path[0]];
    clock.advance(499);
    statesAt.push(actor.snapshot().path[0]);
    clock.advance(1);
    statesAt.push(actor.snapshot().path[0]);
    expect(statesAt).toEqual(["idle", "idle", "done"]);
    expect({ pending: clock.hasPending() }).toEqual({ pending: false });
  });

  test("the actor calls effects on final state entry", () => {
    const pending = state("pending")();
    const done = state("done")().final();
    const finish = event("FINISH")();
    let finalEffectRuns = 0;
    const actor = Actor({
      inputs: [finish],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: finish, handler: () => ({ state: done }) });
        m.effect(done, {
          name: "countFinalEntry",
          fn: () => {
            finalEffectRuns++;
          },
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

    const child = Actor({
      inputs: [childGo],
      outputs: [childOut],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, { eventRef: childGo, handler: () => ({ state: childDone }) });
        m.effect(childDone, { name: "emitChildOut", fn: ({ emit }) => emit(childOut.create()) });
      },
    });

    const parent = Actor({
      inputs: [childOut],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, { eventRef: childOut, handler: () => ({ state: parentActive }) });
      },
    });

    child.send(childGo.create());
    expect({ childDone: child.snapshot().done, parentState: parent.snapshot().path[0] }).toEqual({
      childDone: true,
      parentState: "pactive",
    });
  });

  test("emit after abort is a silent no-op", () => {
    const idle = state("idle")();
    const running = state("running")();
    const trigger = event("GO")();
    const stop = event("STOP")();
    const out = event("OUT")();
    const received: string[] = [];
    let savedEmit: ((e: { type: string; payload?: unknown }) => void) | undefined;
    const actor = Actor({
      inputs: [trigger, stop],
      outputs: [out],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, {
          name: "captureEmit",
          fn: ({ emit }) => {
            savedEmit = emit;
          },
        });
        m.on(idle, { eventRef: trigger, handler: () => ({ state: running }) });
        m.on(running, { eventRef: stop, handler: () => ({ state: idle }) });
      },
    });
    actor.on("output", { fn: (e) => received.push(e.type) });
    actor.send(trigger.create());
    expect(savedEmit).toBeDefined();
    actor.send(stop.create());
    const capturedEmit = savedEmit;
    if (!capturedEmit) {
      expect(capturedEmit).toBeDefined();
      return;
    }
    capturedEmit(out.create());
    expect(received).toEqual([]);
  });

  test("a transition removes the running effect via its abort signal", () => {
    const idle = state("idle")();
    const running = state("running")();
    const trigger = event("GO")();
    const stop = event("STOP")();
    let effectSignal: AbortSignal | undefined;

    const actor = Actor({
      inputs: [trigger, stop],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, {
          name: "captureSignal",
          fn: ({ signal }) => {
            effectSignal = signal;
          },
        });
        m.on(idle, { eventRef: trigger, handler: () => ({ state: running }) });
        m.on(running, { eventRef: stop, handler: () => ({ state: idle }) });
      },
    });

    actor.send(trigger.create());
    const abortedBefore = effectSignal?.aborted;
    actor.send(stop.create());
    expect([abortedBefore, effectSignal?.aborted]).toEqual([false, true]);
  });

  test("runEffects calls effects with the state payload", () => {
    const idle = state("idle")();
    const running = state("running")<{ url: string }>();
    const trigger = event("GO")();
    let payload: unknown;

    const actor = Actor({
      inputs: [trigger],
      states: [idle, running],
      initial: idle,
      setup: (m) => {
        m.effect(running, {
          name: "capturePayload",
          fn: ({ state }) => {
            payload = state.payload;
          },
        });
        m.on(idle, {
          eventRef: trigger,
          handler: () => ({ state: running.create({ url: "https://x" }) }),
        });
      },
    });

    actor.send(trigger.create());
    expect(payload).toEqual({ url: "https://x" });
  });
});

describe("Actor regions", () => {
  test("the parent queue treats child output as input and drains it", () => {
    const childIdle = state("cidle")();
    const childDone = state("cdone")();
    const childGo = event("CGO")();
    const doneEvt = event("CHILD_DONE")();
    const parentIdle = state("pidle")();
    const parentActive = state("pactive")();

    const child = Actor({
      inputs: [childGo],
      outputs: [doneEvt],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, {
          eventRef: childGo,
          handler: () => ({ state: childDone, emit: [doneEvt.create()] }),
        });
      },
    });

    const parent = Actor({
      inputs: [doneEvt],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, { eventRef: doneEvt, handler: () => ({ state: parentActive }) });
      },
    });

    child.send(childGo.create());
    const regionSnap = parent.snapshot();
    expect({
      parentState: regionSnap.path[0],
      childState: child.snapshot().path[0],
    }).toEqual({ parentState: "pactive", childState: "cdone" });
  });

  test("dispose() calls dispose on region child actors", () => {
    const childClock = VirtualClock();
    const cIdle = state("cidle")();
    const parentIdle = state("pidle")();

    const child = Actor({
      inputs: [],
      states: [cIdle],
      initial: cIdle,
      clock: childClock,
      setup: (m) => {
        m.effect(cIdle, {
          name: "startHeartbeat",
          fn: (input) => {
            input.clock.setInterval(10, { signal: input.signal, cb: () => {} });
          },
        });
      },
    });

    const parent = Actor({
      inputs: [],
      states: [parentIdle],
      initial: parentIdle,
      regions: { child },
      setup: () => {},
    });

    expect(childClock.hasPending()).toBe(true);

    parent.dispose();

    expect(childClock.hasPending()).toBe(false);
    const wideChild: { send(event: { type: string; payload?: unknown }): void } = child;
    wideChild.send({ type: cIdle.name });
    expect(child.snapshot().path[0]).toBe("cidle");
  });
});

describe("Actor context change detection", () => {
  test("context.set without a transition emits change", () => {
    const idle = state("idle")();
    const reset = event("RESET_PROGRESS")();
    const actor = Actor({
      inputs: [reset],
      states: [idle],
      initial: idle,
      context: { progress: 1 },
      setup: (m) => {
        m.on(idle, {
          eventRef: reset,
          handler: (_e, { context }) => {
            context.set({ progress: 0 });
            return {};
          },
        });
      },
    });
    const seen: number[] = [];
    actor.on("change", { fn: (snap) => seen.push(snap.context.progress) });
    actor.send(reset.create());
    expect(seen).toEqual([1, 0]);
  });

  test("subscribers treat the prev snapshot as discriminating state vs context changes", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({
          eventRef: tick,
          handler: (_e, { context }) => {
            context.set({ n: 5 });
            return {};
          },
        });
      },
    });
    const kinds: string[] = [];
    actor.on("change", {
      fn: (...changeInfo) => {
        const [snap, prev] = changeInfo;
        const stateChanged = snap.path[0] !== prev.path[0];
        const contextChanged = snap.context !== prev.context;
        kinds.push(`${stateChanged ? "state" : ""}${contextChanged ? "context" : ""}`);
      },
    });
    actor.send(trigger.create());
    actor.send(tick.create());
    // kinds[0] is the subscribe ping: current vs current.
    expect(kinds).toEqual(["", "state", "context"]);
  });

  test("the snapshot returns a copy of the live context, not the reference (#226)", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const snap = actor.snapshot();
    expect(snap.context).not.toBe(actor.context);
    snap.context.n = 99;
    expect(actor.context.n).toBe(0);
  });

  test("unchanged snapshots keep the same context identity (#226)", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [trigger, tick],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
        m.onAny({
          eventRef: tick,
          handler: (_e, { context }) => {
            context.set({ n: 5 });
            return {};
          },
        });
      },
    });
    const a = actor.snapshot().context;
    actor.send(trigger.create()); // state change only
    const b = actor.snapshot().context;
    /**
     * unchanged context keeps the same reference
     * context change
     */
    expect(b).toBe(a);
    actor.send(tick.create());
    const c = actor.snapshot().context;
    expect(c).not.toBe(b); // changed context gets a new reference
  });

  test("set plus transition in one handler emits a single coalesced change", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      context: { n: 0 },
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: (_e, { context }) => {
            const current = context.get();
            context.set({ ...current, n: 1 });
            return { state: active };
          },
        });
      },
    });
    let calls = 0;
    actor.on("change", { fn: () => calls++ });
    actor.send(trigger.create());
    expect(calls).toBe(2); // subscribe ping + one end-of-dispatch emit
  });

  test("snapshot().context returns the current context reference", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { n: 1 },
      setup: (m) => {
        m.on(idle, {
          eventRef: tick,
          handler: (_e, { context }) => {
            const current = context.get();
            context.set({ ...current, n: 2 });
            return {};
          },
        });
      },
    });
    const contextsAfterSends = [actor.snapshot().context];
    actor.send(tick.create());
    contextsAfterSends.push(actor.snapshot().context);
    expect(contextsAfterSends).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("set with the same reference after in-place mutation emits change", () => {
    interface Progress {
      progress: number;
    }
    function makeProgress(): Progress {
      return { progress: 1 };
    }
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: makeProgress(),
      setup: (m) => {
        m.on(idle, {
          eventRef: tick,
          handler: (_e, { context }) => {
            const current = context.get();
            current.progress += 1;
            context.set(current); // same reference — the write itself is the signal
            return {};
          },
        });
      },
    });
    const seen: number[] = [];
    actor.on("change", { fn: (snapshotInfo) => seen.push(snapshotInfo.context.progress) });
    actor.send(tick.create());
    expect(seen).toEqual([1, 2]);
  });
});

describe("Actor payload normalization", () => {
  test("the machine treats a payload-less event as an empty payload for payload-reading handlers", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    const actor = Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: update,
          handler: (e) => {
            void e.payload.codeSize;
            return {};
          },
        });
      },
    });
    const wide: { send(event: { type: string; payload?: unknown }): void } = actor;
    wide.send({ type: "UPDATE" });
    expect({ error: actor.snapshot().error, state: actor.state.name }).toEqual({
      error: undefined,
      state: "idle",
    });
  });

  test("the snapshot keeps the payload when present", () => {
    const idle = state("idle")();
    const update = event("UPDATE")<{ codeSize: number }>();
    let seen: unknown;
    const actor = Actor({
      inputs: [update],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: update,
          handler: (e) => {
            seen = e.payload;
            return {};
          },
        });
      },
    });
    actor.send(update.create({ codeSize: 3 }));
    expect(seen).toEqual({ codeSize: 3 });
  });
});

describe("Actor snapshot payload", () => {
  test("the snapshot returns the payload of the current state", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: trigger,
          handler: () => ({ state: ready.create({ items: ["a"] }) }),
        });
      },
    });
    const payloadBefore = actor.snapshot().payload;
    actor.send(trigger.create());
    expect([payloadBefore, actor.snapshot().payload]).toEqual([undefined, { items: ["a"] }]);
  });

  test("the snapshot returns an initial payload from the start", () => {
    const ready = state("ready")<{ items: string[] }>();
    const actor = Actor({
      inputs: [],
      states: [ready],
      initial: ready.create({ items: ["a"] }),
      setup: () => {},
    });
    const initialSnap = actor.snapshot();
    expect({ state: initialSnap.path[0], payload: initialSnap.payload }).toEqual({
      state: "ready",
      payload: { items: ["a"] },
    });
  });

  test("a state entered without a payload returns no snapshot payload", () => {
    const idle = state("idle")();
    const ready = state("ready")<{ items: string[] }>();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, ready],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: ready }) });
      },
    });
    actor.send(trigger.create());
    const noPayloadSnap = actor.snapshot();
    expect({ state: noPayloadSnap.path[0], payload: noPayloadSnap.payload }).toEqual({
      state: "ready",
      payload: undefined,
    });
  });
});

describe("Actor transition observability", () => {
  test("the transition hook emits an update for every handled event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    });
    actor.send(trigger.create());
    expect(seen).toEqual([{ from: "idle", to: "active", transitioned: true }]);
  });

  test("the transition hook emits self-transitions as transitioned", () => {
    const home = state("home")();
    const reset = event("RESET")();
    const actor = Actor({
      inputs: [reset],
      states: [home],
      initial: home,
      setup: (m) => {
        m.on(home, { eventRef: reset, handler: () => ({ state: home }) });
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    });
    actor.send(reset.create());
    expect(seen).toEqual([{ from: "home", to: "home", transitioned: true }]);
  });

  test("the transition hook emits no-op handlers as not transitioned", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: tick, handler: () => ({}) });
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    });
    actor.send(tick.create());
    expect(seen).toEqual([{ from: "idle", to: "idle", transitioned: false }]);
  });

  test("the transition hook emits an onAny handler transition", () => {
    const idle = state("idle")();
    const active = state("active")();
    const trigger = event("GO")();
    const actor = Actor({
      inputs: [trigger],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.onAny({ eventRef: trigger, handler: () => ({ state: active }) });
      },
    });
    const seen: Array<{ from: string; to: string; transitioned: boolean }> = [];
    actor.on("transition", {
      fn: (info) => seen.push({ from: info.from, to: info.to, transitioned: info.transitioned }),
    });
    actor.send(trigger.create());
    expect(seen).toEqual([{ from: "idle", to: "active", transitioned: true }]);
  });

  test("cascaded events each get their own transition hook call", () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const start = event("START")();
    const next = event("NEXT")();
    const actor = Actor({
      inputs: [start],
      internal: [next],
      states: [a, b, c],
      initial: a,
      setup: (m) => {
        m.on(a, { eventRef: start, handler: () => ({ state: b }) });
        m.effect(b, { name: "emitNext", fn: ({ emit }) => emit(next.create()) });
        m.on(b, { eventRef: next, handler: () => ({ state: c }) });
      },
    });
    const seen: Array<{ from: string; to: string }> = [];
    actor.on("transition", { fn: (info) => seen.push({ from: info.from, to: info.to }) });
    actor.send(start.create());
    expect(new Set(seen.map((s) => `${s.from}->${s.to}`))).toEqual(new Set(["a->b", "b->c"]));
  });
});
