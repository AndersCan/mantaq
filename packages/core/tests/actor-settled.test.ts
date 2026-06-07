import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

describe("settled", () => {
  test("resolves immediately when no pending operations", async () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on }),
        },
      },
    });

    const p = actor.settled();
    expect(p).toBeInstanceOf(Promise);
    await p;
  });

  test("resolves after internal queue drains following send", async () => {
    const toggle = event("toggled")();
    const internalEvent = event("internal")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on, emit: [internalEvent.create({})] }),
        },
        on: {
          internal: () => ({ state: off }),
        },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("off");

    await actor.settled();
  });

  test("resolves after multiple sequential sends", async () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on }),
        },
        on: {
          toggled: () => ({ state: off }),
        },
      },
    });

    actor.send(toggle);
    actor.send(toggle);
    actor.send(toggle);

    await actor.settled();
    expect(actor.state.name).toBe("on");
  });

  test("resolves with effects that complete", async () => {
    const load = event("load")();
    const loaded = event("loaded")();
    const idle = state("idle")();
    const loading = state("loading")();
    const done = state("done")();

    const actor = new Actor({
      inputs: [load],
      outputs: [],
      internal: [loaded],
      context: {},
      states: [idle, loading, done],
      initial: idle,
      effects: {
        loading: [
          ({ emit }) => {
            emit(loaded.create({}));
          },
        ],
      },
      transitions: {
        idle: {
          load: () => ({ state: loading }),
        },
        loading: {
          loaded: () => ({ state: done }),
        },
      },
    });

    actor.send(load);
    expect(actor.state.name).toBe("done");

    await actor.settled();
  });

  test("multiple settled calls all resolve", async () => {
    const toggle = event("toggled")();
    const internalEvent = event("internal")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: on, emit: [internalEvent.create({})] }),
        },
        on: {
          internal: () => ({ state: off }),
        },
      },
    });

    actor.send(toggle);

    const p1 = actor.settled();
    const p2 = actor.settled();
    const p3 = actor.settled();

    await Promise.all([p1, p2, p3]);
    expect(actor.state.name).toBe("off");
  });

  test("settled resolves after effect-triggered internal events", async () => {
    const start = event("start")();
    const result = event("result")();
    const idle = state("idle")();
    const processing = state("processing")();
    const completed = state("completed")();
    const clock = new VirtualClock();

    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [result],
      context: {},
      states: [idle, processing, completed],
      initial: idle,
      clock,
      effects: {
        processing: [
          ({ emit, clock }) => {
            clock.setTimeout(10, () => {
              emit(result.create({ value: 42 }));
            });
          },
        ],
      },
      transitions: {
        idle: {
          start: () => ({ state: processing }),
        },
        processing: {
          result: () => ({ state: completed }),
        },
      },
    });

    actor.send(start);
    clock.advance(10);

    await actor.settled();
    expect(actor.state.name).toBe("completed");
  });
});
