import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "./drive.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createThrowingActor } from "./fixtures/throwing.ts";
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
    const driver = createDriver(timed);
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
    const driver = createDriver(timed);
    driver.step({ kind: "event", event: "start", payload: null });
    driver.step({ kind: "advance", ms: 800 });
    const live = driver.reset();
    expect(live).toMatchObject({ state: "idle", steps: [], last: null, timers: [] });
    expect(driver.step({ kind: "advance", ms: 800 }).state).toBe("idle");
  });
});
