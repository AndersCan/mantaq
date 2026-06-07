import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

function makeLoadActor(clock: VirtualClock) {
  const load = event("load")<{ url: string }>();
  const fetchDone = event("fetchDone")<{ data: string }>();
  const fetchError = event("fetchError")<{ error: string }>();
  const timeout = event("timeout")();
  const retry = event("retry")();

  const idle = state("idle")();
  const loading = state("loading")<{ url: string }>();
  const success = state("success")<{ data: string }>();
  const failed = state("failed")<{ error: string }>();

  const actor = new Actor({
    inputs: [load],
    outputs: [],
    internal: [fetchDone, fetchError, timeout, retry],
    context: {},
    states: [idle, loading, success, failed],
    initial: idle,
    clock,
    effects: {
      loading: [
        ({ signal, emit, clock }) => {
          const id = clock.setTimeout(5000, () => {
            emit(timeout.create(undefined));
          });
          signal.addEventListener("abort", () => clock.clearTimeout(id));
        },
      ],
    },
    transitions: {
      idle: {
        load: (e) => ({ state: loading, payload: { url: e.url } }),
      },
      loading: {
        fetchDone: () => ({ state: success }),
        fetchError: () => ({ state: failed }),
        timeout: () => ({ state: failed }),
      },
    },
  });

  return { actor, load, fetchDone, fetchError, timeout, retry, idle, loading, success, failed };
}

describe("timers", () => {
  test("timer fires after advance", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    expect(actor.state.name).toBe("loading");

    clock.advance(3000);
    expect(actor.state.name).toBe("loading");

    clock.advance(2000);
    expect(actor.state.name).toBe("failed");
  });

  test("timer auto-cancels on state exit", () => {
    const clock = new VirtualClock();
    const { actor, load, fetchDone } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    expect(actor.state.name).toBe("loading");

    actor.send(fetchDone.create({ data: "ok" }));
    expect(actor.state.name).toBe("success");

    clock.advance(10000);
    expect(actor.state.name).toBe("success");
  });

  test("timer fires only if no early transition", () => {
    const clock = new VirtualClock();
    const { actor, load, fetchError } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(1000);
    expect(actor.state.name).toBe("loading");

    actor.send(fetchError.create({ error: "500" }));
    expect(actor.state.name).toBe("failed");

    clock.advance(10000);
    expect(actor.state.name).toBe("failed");
  });

  test("advance partially — timer not yet due", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(4999);
    expect(actor.state.name).toBe("loading");
    expect(clock.hasPending()).toBe(true);
  });

  test("advance past deadline fires immediately", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(10000);
    expect(actor.state.name).toBe("failed");
    expect(clock.hasPending()).toBe(false);
  });

  test("multiple advance calls accumulate", () => {
    const clock = new VirtualClock();
    const { actor, load } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(1000);
    clock.advance(1000);
    clock.advance(1000);
    clock.advance(1000);
    clock.advance(1000);
    expect(actor.state.name).toBe("failed");
  });

  test("state-scoped timer uses signal abort on exit", () => {
    const clock = new VirtualClock();
    const { actor, load, fetchDone } = makeLoadActor(clock);

    actor.send(load.create({ url: "/api/data" }));
    expect(clock.hasPending()).toBe(true);

    actor.send(fetchDone.create({ data: "ok" }));
    expect(clock.hasPending()).toBe(false);
  });

  test("multiple effects — all run on entry", () => {
    const clock = new VirtualClock();
    const load = event("load")<{ url: string }>();
    const fetchDone = event("fetchDone")<{ data: string }>();
    const timeout = event("timeout")();
    const warn = event("warn")();

    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();
    const success = state("success")<{ data: string }>();
    const warned = state("warned")();

    const warnTimings: number[] = [];
    const timeoutTimings: number[] = [];

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [fetchDone, timeout, warn],
      context: {},
      states: [idle, loading, success, warned],
      initial: idle,
      clock,
      effects: {
        loading: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(5000, () => {
              timeoutTimings.push((clock as VirtualClock).now());
              emit(timeout.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(2000, () => {
              warnTimings.push((clock as VirtualClock).now());
              emit(warn.create(undefined));
            });
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: {
          load: (e) => ({ state: loading, payload: { url: e.url } }),
        },
        loading: {
          fetchDone: () => ({ state: success }),
          timeout: () => ({ state: warned }),
          warn: () => ({ state: warned }),
        },
      },
    });

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(2000);
    expect(warnTimings).toEqual([2000]);
    expect(actor.state.name).toBe("warned");

    clock.advance(3000);
    expect(timeoutTimings).toEqual([]);
  });

  test("timer event enqueues to internal queue", () => {
    const clock = new VirtualClock();
    const load = event("load")<{ url: string }>();
    const timeout = event("timeout")();
    const onTimeout = event("onTimeout")();

    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();
    const done = state("done")();

    let processed = false;

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [timeout, onTimeout],
      context: {},
      states: [idle, loading, done],
      initial: idle,
      clock,
      effects: {
        loading: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(1000, () => emit(timeout.create(undefined)));
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: {
          load: (e) => ({ state: loading, payload: { url: e.url } }),
        },
        loading: {
          timeout: () => {
            processed = true;
            return { state: done };
          },
        },
      },
    });

    actor.send(load.create({ url: "/api/data" }));
    clock.advance(1000);
    expect(processed).toBe(true);
    expect(actor.state.name).toBe("done");
  });

  test("heartbeat idle-suppress pattern", () => {
    const clock = new VirtualClock();
    const connect = event("connect")();
    const sendMsg = event("sendMsg")<{ msg: string }>();
    const heartbeatDue = event("heartbeatDue")();
    const outboundSent = event("outboundSent")();

    const idle = state("idle")();
    const active = state("active")();

    let heartbeatsSent = 0;

    const actor = new Actor({
      inputs: [connect, sendMsg],
      outputs: [],
      internal: [heartbeatDue, outboundSent],
      context: {},
      states: [idle, active],
      initial: idle,
      clock,
      effects: {
        active: [
          ({ signal, emit, clock }) => {
            const id = clock.setTimeout(30_000, () => emit(heartbeatDue.create(undefined)));
            signal.addEventListener("abort", () => clock.clearTimeout(id));
          },
        ],
      },
      transitions: {
        idle: {
          connect: () => ({ state: active }),
        },
        active: {
          heartbeatDue: () => {
            heartbeatsSent++;
            return { emit: [outboundSent.create(undefined)] };
          },
          outboundSent: () => ({ state: active }),
          sendMsg: () => {
            return { emit: [outboundSent.create(undefined)] };
          },
        },
      },
    });

    actor.send(connect);
    expect(actor.state.name).toBe("active");

    clock.advance(10_000);
    expect(heartbeatsSent).toBe(0);

    clock.advance(20_000);
    expect(heartbeatsSent).toBe(1);

    clock.advance(30_000);
    expect(heartbeatsSent).toBe(2);
  });
});
