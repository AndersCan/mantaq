import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createSenderActor } from "./fixtures/wired/sender.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
import { createMeal6 } from "../../../apps/docs/src/tutorial/meal-06.ts";
import type { VizJson } from "@mantaq/viz";
import type { FuzzTarget } from "./fuzz/run.ts";

const checkout: FuzzTarget = {
  id: "checkout",
  create: () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  },
};

const basic = {
  kind: "event",
  event: "submitBasicInfo",
  payload: { email: "a@b.c", name: "A" },
} as const;

const idle = state("idle")();
const waiting = state("waiting")();
const timedOut = state("timedOut")();
const start = event("start")();
const expired = event("expired")();

const timed: FuzzTarget = {
  id: "timed",
  create: () => {
    const clock = VirtualClock();
    const actor = Actor({
      inputs: [start],
      internal: [expired],
      states: [idle, waiting, timedOut],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: start, to: [waiting], handler: () => ({ state: waiting }) });
        m.effect(waiting, {
          name: "deadline",
          sends: [expired],
          fn: (input) => withTimeout(800, { input, event: () => expired.create() }),
        });
        m.on(waiting, { event: expired, to: [timedOut], handler: () => ({ state: timedOut }) });
      },
    });
    return { actor, clock };
  },
};

describe("createDriver", () => {
  test("send moves the actor and records the step", () => {
    const driver = createDriver(checkout);
    expect(driver.reset().state).toBe("basicInfo");
    const live = driver.step(basic);
    expect(live.state).toBe("shippingAddress");
    expect(live.steps).toEqual([basic]);
    expect(live.last).toMatchObject({
      from: "basicInfo",
      event: "submitBasicInfo",
      to: "shippingAddress",
      outcome: "transition",
      error: null,
    });
    expect(live.context).toMatchObject({ basicInfo: { email: "a@b.c" } });
  });

  test("a step records the outputs the machine sent, in order", () => {
    const sender: FuzzTarget = {
      id: "sender",
      create: () => {
        const clock = VirtualClock();
        return { actor: createSenderActor(clock), clock };
      },
    };
    const driver = createDriver(sender);
    driver.reset();
    const live = driver.step({ kind: "event", event: "go", payload: null });
    expect(live.last?.sent).toEqual(["handedOver"]);
    expect(driver.step({ kind: "event", event: "go", payload: null }).last?.sent).toEqual([]);
  });

  test("a step that sends nothing records no outputs", () => {
    const driver = createDriver(checkout);
    driver.reset();
    expect(driver.step(basic).last?.sent).toEqual([]);
  });

  test("an event the state does not handle is ignored", () => {
    const driver = createDriver(checkout);
    const live = driver.step({ kind: "event", event: "back", payload: null });
    expect(live.state).toBe("basicInfo");
    expect(live.last).toMatchObject({ outcome: "ignored", from: "basicInfo", to: "basicInfo" });
  });

  test("an internal event the state cannot handle is ignored", () => {
    const driver = createDriver(checkout);
    const live = driver.step({ kind: "event", event: "paymentTimeout", payload: null });
    expect(live.last?.outcome).toBe("ignored");
  });

  test("an internal event the state handles transitions", () => {
    const driver = createDriver(checkout);
    for (const event of ["submitBasicInfo", "submitShipping", "submitPayment"]) {
      const payload: VizJson =
        event === "submitBasicInfo"
          ? { email: "a@b.c", name: "A" }
          : event === "submitShipping"
            ? { street: "s", city: "c", zip: "1" }
            : { cardNumber: "4242" };
      driver.step({ kind: "event", event, payload });
    }
    const live = driver.step({ kind: "event", event: "paymentFail", payload: { reason: "x" } });
    expect(live.state).toBe("error");
    expect(live.last?.outcome).toBe("transition");
  });

  test("advance fires the labelled timer", () => {
    const driver = createDriver(timed, { effectMode: "real" });
    const waitingLive = driver.step({ kind: "event", event: "start", payload: null });
    expect(waitingLive.timers).toEqual([
      expect.objectContaining({ ms: 800, deadline: 800, eventName: "expired" }),
    ]);
    const early = driver.step({ kind: "advance", ms: 799 });
    expect(early.state).toBe("waiting");
    expect(early.last).toBeNull();
    const fired = driver.step({ kind: "advance", ms: 1 });
    expect(fired.state).toBe("timedOut");
    expect(fired.timers).toEqual([]);
    expect(fired.last).toMatchObject({ event: "expired", outcome: "transition" });
  });

  test("a throwing handler reports its error", () => {
    const driver = createDriver({
      id: "throwing",
      create: () => {
        const clock = VirtualClock();
        return { actor: createThrowingActor(clock), clock };
      },
    });
    const live = driver.step({ kind: "event", event: "pick", payload: { side: "b" } });
    expect(live.last?.error).toContain("TypeError");
    expect(live.state).toBe("__error");
  });

  test("reset starts over with an empty log and a fresh clock", () => {
    const driver = createDriver(timed, { effectMode: "real" });
    driver.step({ kind: "event", event: "start", payload: null });
    driver.step({ kind: "advance", ms: 800 });
    const live = driver.reset();
    expect(live).toMatchObject({ state: "idle", steps: [], last: null, timers: [] });
    expect(driver.step({ kind: "advance", ms: 800 }).state).toBe("idle");
  });
});

const ping = event("ping")();
const pong = event("pong")();
const asyncTarget = (mode: "sync" | "async"): FuzzTarget => ({
  id: "async",
  create: () => {
    const clock = VirtualClock();
    const actor = Actor({
      inputs: [ping],
      internal: [pong],
      states: [idle, waiting, timedOut],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: ping, to: [waiting], handler: () => ({ state: waiting }) });
        m.effect(waiting, {
          name: "reply",
          sends: [pong],
          fn: async ({ emit }) => {
            if (mode === "async") await Promise.resolve();
            emit(pong.create());
          },
        });
        m.on(waiting, { event: pong, to: [timedOut], handler: () => ({ state: timedOut }) });
      },
    });
    return { actor, clock };
  },
});
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pingStep = { kind: "event", event: "ping", payload: null } as const;

describe("createDriver effect results", () => {
  test("a sync effect follow-up is in after, not overwriting last", () => {
    const driver = createDriver(asyncTarget("sync"), { effectMode: "real" });
    const live = driver.step(pingStep);
    expect(live.last).toMatchObject({ event: "ping", to: "waiting", effects: ["reply"] });
    expect(live.after).toEqual([expect.objectContaining({ event: "pong", to: "timedOut" })]);
  });

  test("an async effect result calls listen with one after entry", async () => {
    const driver = createDriver(asyncTarget("async"), { effectMode: "real" });
    const seen: Array<{ state: string; after: number }> = [];
    driver.listen?.((live) => seen.push({ state: live.state, after: live.after.length }));
    const first = driver.step(pingStep);
    expect(first.state).toBe("waiting");
    expect(first.after).toEqual([]);
    expect(seen).toEqual([]);
    await macrotask();
    expect(seen).toEqual([{ state: "timedOut", after: 1 }]);
  });

  test("reset during a pending async effect never calls back", async () => {
    const driver = createDriver(asyncTarget("async"), { effectMode: "real" });
    const seen: string[] = [];
    driver.listen?.((live) => seen.push(live.state));
    driver.step(pingStep);
    driver.reset();
    await macrotask();
    expect(seen).toEqual([]);
  });
});

describe("createDriver ordering inside one step", () => {
  const toB = event("toB")();
  const toA = event("toA")();
  const stateA = state("a")();
  const stateB = state("b")();
  const cycle: FuzzTarget = {
    id: "cycle",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [],
        internal: [toB, toA],
        states: [stateA, stateB],
        initial: stateA,
        clock,
        setup: (m) => {
          m.effect(stateA, {
            name: "waitA",
            sends: [toB],
            fn: (input) => withTimeout(100, { input, event: () => toB.create() }),
          });
          m.effect(stateB, {
            name: "waitB",
            sends: [toA],
            fn: (input) => withTimeout(100, { input, event: () => toA.create() }),
          });
          m.on(stateA, { event: toB, to: [stateB], handler: () => ({ state: stateB }) });
          m.on(stateB, { event: toA, to: [stateA], handler: () => ({ state: stateA }) });
        },
      });
      return { actor, clock };
    },
  };

  test("timers that cycle between states stay in chronological order", () => {
    const live = createDriver(cycle, { effectMode: "real" }).step({ kind: "advance", ms: 250 });
    expect(live.last).toMatchObject({ event: "toB", from: "a", to: "b" });
    expect(live.after).toEqual([expect.objectContaining({ event: "toA", from: "b", to: "a" })]);
  });
});

describe("createDriver sync effect sending two events", () => {
  const go = event("go")();
  const one = event("one")();
  const two = event("two")();
  const s0 = state("s0")();
  const s1 = state("s1")();
  const s2 = state("s2")();
  const s3 = state("s3")();
  test("both follow-ups come after the starter, in order", () => {
    const driver = createDriver(
      {
        id: "two",
        create: () => {
          const clock = VirtualClock();
          const actor = Actor({
            inputs: [go],
            internal: [one, two],
            states: [s0, s1, s2, s3],
            initial: s0,
            clock,
            setup: (m) => {
              m.on(s0, { event: go, to: [s1], handler: () => ({ state: s1 }) });
              m.effect(s1, {
                name: "fan",
                sends: [one],
                fn: ({ emit }) => emit(one.create()),
              });
              m.on(s1, { event: one, to: [s2], handler: () => ({ state: s2 }) });
              m.effect(s2, {
                name: "fan2",
                sends: [two],
                fn: ({ emit }) => emit(two.create()),
              });
              m.on(s2, { event: two, to: [s3], handler: () => ({ state: s3 }) });
            },
          });
          return { actor, clock };
        },
      },
      { effectMode: "real" },
    );
    const live = driver.step({ kind: "event", event: "go", payload: null });
    expect(live.last).toMatchObject({ event: "go", from: "s0", to: "s1" });
    expect(live.after.map((entry) => entry.event)).toEqual(["one", "two"]);
  });
});

describe("createDriver payload", () => {
  const home = state("home")();
  const waitingFor = state("waitingFor")<{ code: string }>();
  const holding = state("holding")<{ run: () => void }>();
  const ask = event("ask")();
  const hold = event("hold")();
  const payloads: FuzzTarget = {
    id: "payloads",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [ask, hold],
        states: [home, waitingFor, holding],
        initial: home,
        clock,
        setup: (m) => {
          m.on(home, {
            event: ask,
            to: [waitingFor],
            handler: () => ({ state: waitingFor, payload: { code: "c1" } }),
          });
          m.on(home, {
            event: hold,
            to: [holding],
            handler: () => ({ state: holding, payload: { run: () => {} } }),
          });
        },
      });
      return { actor, clock };
    },
  };

  test("null after reset, the payload after entering the state", () => {
    const driver = createDriver(payloads);
    expect(driver.reset().payload).toBeNull();
    expect(driver.step({ kind: "event", event: "ask", payload: null }).payload).toEqual({
      code: "c1",
    });
  });

  test("a payload holding a function reports null", () => {
    const driver = createDriver(payloads);
    driver.reset();
    expect(driver.step({ kind: "event", event: "hold", payload: null }).payload).toBeNull();
  });
});

describe("createDriver held effects", () => {
  const paid = event("paid")();
  const declined = event("declined")();
  const loaded = event("loaded")();
  const idleS = state("idle")();
  const charging = state("charging")();
  const paidS = state("paid")();
  const declinedS = state("declined")();
  const loading = state("loading")();
  const ready = state("ready")();
  const startEv = event("start")();
  const called: string[] = [];

  const chargeTarget: FuzzTarget = {
    id: "charging",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [startEv],
        internal: [paid, declined],
        states: [idleS, charging, paidS, declinedS],
        initial: idleS,
        clock,
        setup: (m) => {
          m.on(idleS, { event: startEv, to: [charging], handler: () => ({ state: charging }) });
          m.effect(charging, {
            name: "charge",
            sends: [paid, declined],
            fn: (input) => {
              called.push("charge");
              withTimeout(800, { input, event: () => declined.create() });
              return Promise.resolve().then(() => input.emit(paid.create()));
            },
          });
          m.on(charging, { event: paid, to: [paidS], handler: () => ({ state: paidS }) });
          m.on(charging, {
            event: declined,
            to: [declinedS],
            handler: () => ({ state: declinedS }),
          });
        },
      });
      return { actor, clock };
    },
  };
  const loadTarget: FuzzTarget = {
    id: "loading",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [startEv],
        internal: [loaded],
        states: [loading, ready],
        initial: loading,
        clock,
        setup: (m) => {
          m.effect(loading, {
            name: "load",
            sends: [loaded],
            fn: ({ emit }) => emit(loaded.create()),
          });
          m.on(loading, { event: loaded, to: [ready], handler: () => ({ state: ready }) });
          m.on(ready, { event: startEv, to: [loading], handler: () => ({ state: loading }) });
        },
      });
      return { actor, clock };
    },
  };
  const startStep = { kind: "event", event: "start", payload: null } as const;
  const paidStep = { kind: "event", event: "paid", payload: null } as const;

  test("held: entering a state with an effect waits there", async () => {
    called.length = 0;
    const driver = createDriver(chargeTarget);
    const seen: string[] = [];
    driver.listen?.((live) => seen.push(live.state));
    const live = driver.step(startStep);
    expect(live).toMatchObject({
      state: "charging",
      waiting: ["charge"],
      timers: [],
      effectMode: "held",
    });
    expect(live.last?.effects).toEqual(["charge"]);
    await macrotask();
    expect(seen).toEqual([]);
    expect(called).toEqual([]);
  });

  test("held: an injected report leaves the state and clears waiting", () => {
    const driver = createDriver(chargeTarget);
    driver.step(startStep);
    const live = driver.step(paidStep);
    expect(live).toMatchObject({ state: "paid", waiting: [] });
  });

  test("held: reset while waiting drops the held effect", async () => {
    const driver = createDriver(chargeTarget);
    const seen: string[] = [];
    driver.listen?.((live) => seen.push(live.state));
    driver.step(startStep);
    expect(driver.reset().waiting).toEqual([]);
    await macrotask();
    expect(seen).toEqual([]);
  });

  test("held: the first state's effects run for real", () => {
    const driver = createDriver(loadTarget);
    expect(driver.reset()).toMatchObject({ state: "ready", waiting: [] });
    expect(driver.step(startStep)).toMatchObject({ state: "loading", waiting: ["load"] });
  });

  test("held: an effect inside a region is held and listed in waiting", () => {
    const regionCalled: string[] = [];
    const poke = event("poke")();
    const childIdle = state("childIdle")();
    const childBusy = state("childBusy")();
    const parentIdle = state("parentIdle")();
    let startChild = () => {};
    const target: FuzzTarget = {
      id: "region",
      create: () => {
        const clock = VirtualClock();
        const child = Actor({
          inputs: [startEv],
          states: [childIdle, childBusy],
          initial: childIdle,
          clock,
          setup: (m) => {
            m.on(childIdle, {
              event: startEv,
              to: [childBusy],
              handler: () => ({ state: childBusy }),
            });
            m.effect(childBusy, {
              name: "childWork",
              fn: () => {
                regionCalled.push("childWork");
              },
            });
          },
        });
        const actor = Actor({
          inputs: [poke],
          states: [parentIdle],
          initial: parentIdle,
          clock,
          regions: { child },
          setup: () => {},
        });
        startChild = () => {
          child.send(startEv.create());
        };
        return { actor, clock };
      },
    };
    const driver = createDriver(target);
    startChild();
    const live = driver.step({ kind: "event", event: "poke", payload: null });
    expect(regionCalled).toEqual([]);
    expect(live.waiting).toEqual(["childWork"]);
  });

  test("real: effects run as before", async () => {
    const driver = createDriver(chargeTarget, { effectMode: "real" });
    const seen: string[] = [];
    driver.listen?.((live) => seen.push(live.state));
    const live = driver.step(startStep);
    expect(live).toMatchObject({ effectMode: "real", waiting: [] });
    await macrotask();
    expect(seen).toEqual(["paid"]);
  });
});

describe("dryRun", () => {
  const meal: FuzzTarget = {
    id: "meal6",
    create: () => {
      const clock = VirtualClock();
      return { actor: createMeal6(clock), clock };
    },
  };
  const eat = {
    kind: "event",
    event: "eat",
    payload: { food: "soup" },
  } as const;
  const serve = { kind: "event", event: "serve", payload: null } as const;

  test("a guarded step stays until the context meets it, then transitions", () => {
    const driver = createDriver(meal);
    expect(driver.dryRun?.([eat])).toMatchObject([{ outcome: "stay", from: "hungry" }]);
    driver.step(serve);
    expect(driver.dryRun?.([eat])).toMatchObject([{ outcome: "transition", to: "full" }]);
  });

  test("the live actor, its steps and its listener are untouched", () => {
    const driver = createDriver(meal);
    driver.step(serve);
    let calls = 0;
    driver.listen?.(() => {
      calls += 1;
    });
    const before = driver.step(serve);
    calls = 0;
    driver.dryRun?.([eat, serve]);
    const after = driver.reset();
    expect(calls).toBe(0);
    expect(after.steps).toHaveLength(0);
    expect(before.steps).toHaveLength(2);
    driver.step(serve);
    driver.dryRun?.([eat]);
    const live = driver.step(serve);
    expect(live.steps).toHaveLength(2);
    expect(live.state).toBe("hungry");
  });

  test("candidates are independent of each other", () => {
    const driver = createDriver(meal);
    expect(driver.dryRun?.([serve, eat])).toMatchObject([
      { event: "serve", context: { plates: 1 } },
      { event: "eat", outcome: "stay", from: "hungry" },
    ]);
  });
});
