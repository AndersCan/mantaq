import { expect, test, describe } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

function makeActorWithEffects(effects?: Record<string, Array<(options: any) => void>>) {
  const toggle = event("toggled")();
  const off = state("off")();
  const on = state("on")();
  const done = state("done")().final();

  return new Actor({
    inputs: [toggle],
    outputs: [],
    internal: [],
    context: {},
    states: [off, on, done],
    initial: off,
    effects: effects ?? {},
    transitions: {
      off: {
        toggled: () => ({ state: on }),
      },
      on: {
        toggled: () => ({ state: off }),
      },
    },
  });
}

describe("on('change')", () => {
  test("subscribes and receives snapshot on subscription", () => {
    const actor = makeActorWithEffects();
    let receivedSnap: any = null;

    actor.on("change", (snap) => {
      receivedSnap = snap;
    });

    expect(receivedSnap).toEqual({ path: ["off"], regions: {} });
  });

  test("receives snapshot on state transition", () => {
    const actor = makeActorWithEffects();
    const toggle = event("toggled")();
    const snaps: any[] = [];

    actor.on("change", (snap) => {
      snaps.push(snap);
    });

    actor.send(toggle);

    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toEqual({ path: ["off"], regions: {} });
    expect(snaps[1]).toEqual({ path: ["on"], regions: {} });
  });

  test("unsubscribe stops delivery", () => {
    const actor = makeActorWithEffects();
    const toggle = event("toggled")();
    const snaps: any[] = [];

    const unsub = actor.on("change", (snap) => {
      snaps.push(snap);
    });

    unsub();
    actor.send(toggle);

    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual({ path: ["off"], regions: {} });
  });

  test("multiple subscribers all receive events", () => {
    const actor = makeActorWithEffects();
    const toggle = event("toggled")();
    const snaps1: any[] = [];
    const snaps2: any[] = [];

    actor.on("change", (snap) => snaps1.push(snap));
    actor.on("change", (snap) => snaps2.push(snap));

    actor.send(toggle);

    expect(snaps1).toHaveLength(2);
    expect(snaps2).toHaveLength(2);
  });
});

describe("on('error')", () => {
  test("receives error from effect", () => {
    const errors: unknown[] = [];
    const toggle = event("toggled")();

    const actor = makeActorWithEffects({
      on: [
        () => {
          throw new Error("boom");
        },
      ],
    });

    actor.on("error", (err) => {
      errors.push(err);
    });

    actor.send(toggle);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("boom");
  });

  test("multiple error subscribers all receive", () => {
    const errors1: unknown[] = [];
    const errors2: unknown[] = [];
    const toggle = event("toggled")();

    const actor = makeActorWithEffects({
      on: [
        () => {
          throw new Error("fail");
        },
      ],
    });

    actor.on("error", (err) => errors1.push(err));
    actor.on("error", (err) => errors2.push(err));

    actor.send(toggle);

    expect(errors1).toHaveLength(1);
    expect(errors2).toHaveLength(1);
  });

  test("unsubscribe stops error delivery", () => {
    const errors: unknown[] = [];
    const toggle = event("toggled")();

    const actor = makeActorWithEffects({
      on: [
        () => {
          throw new Error("fail");
        },
      ],
    });

    const unsub = actor.on("error", (err) => errors.push(err));
    unsub();

    actor.send(toggle);

    expect(errors).toHaveLength(0);
  });
});

describe("on('done')", () => {
  test("fires when reaching final state", () => {
    const doneEvents: any[] = [];
    const toggle = event("toggled")();

    const off = state("off")();
    const done = state("done")().final();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, done],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: done }),
        },
      },
    });

    actor.on("done", () => {
      doneEvents.push(true);
    });

    actor.send(toggle);

    expect(doneEvents).toHaveLength(1);
  });

  test("does not fire on non-final state", () => {
    const doneEvents: any[] = [];
    const toggle = event("toggled")();

    const actor = makeActorWithEffects();

    actor.on("done", () => {
      doneEvents.push(true);
    });

    actor.send(toggle);

    expect(doneEvents).toHaveLength(0);
  });

  test("multiple done subscribers all fire", () => {
    const done1: any[] = [];
    const done2: any[] = [];
    const toggle = event("toggled")();

    const off = state("off")();
    const done = state("done")().final();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, done],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: done }),
        },
      },
    });

    actor.on("done", () => done1.push(true));
    actor.on("done", () => done2.push(true));

    actor.send(toggle);

    expect(done1).toHaveLength(1);
    expect(done2).toHaveLength(1);
  });

  test("unsubscribe stops done delivery", () => {
    const doneEvents: any[] = [];
    const toggle = event("toggled")();

    const off = state("off")();
    const done = state("done")().final();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, done],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: () => ({ state: done }),
        },
      },
    });

    const unsub = actor.on("done", () => doneEvents.push(true));
    unsub();

    actor.send(toggle);

    expect(doneEvents).toHaveLength(0);
  });
});
