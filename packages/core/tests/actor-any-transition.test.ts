import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

describe("Any wildcard transition", () => {
  test("matches any event when no specific transition exists", () => {
    const reset = event("reset")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [reset],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          reset: () => ({ state: on }),
        },
      },
    });

    actor.send(reset);
    expect(actor.state.name).toBe("on");
  });

  test("does not fire when no matching event id", () => {
    const toggle = event("toggled")();
    const reset = event("reset")();
    const off = state("off")();

    const actor = new Actor({
      inputs: [toggle, reset],
      outputs: [],
      internal: [],
      context: {},
      states: [off],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          reset: () => ({ state: off }),
        },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("off");
  });

  test("state-specific handler takes priority over Any", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();
    const special = state("special")();

    let anyFired = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on, special],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          toggled: () => {
            anyFired = true;
            return { state: special };
          },
        },
        off: {
          toggled: () => ({ state: on }),
        },
      },
    });

    actor.send(toggle);
    expect(actor.state.name).toBe("on");
    expect(anyFired).toBe(true);
  });

  test("Any without state falls through to specific transition", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();
    let anyFired = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          toggled: () => {
            anyFired = true;
            return {};
          },
        },
        off: {
          toggled: () => ({ state: on }),
        },
      },
    });

    actor.send(toggle);
    expect(anyFired).toBe(true);
    expect(actor.state.name).toBe("on");
  });

  test("works across multiple states", () => {
    const reset = event("reset")();
    const a = state("a")();
    const b = state("b")();

    const actor = new Actor({
      inputs: [reset],
      outputs: [],
      internal: [],
      context: {},
      states: [a, b],
      initial: a,
      effects: {},
      transitions: {
        Any: {
          reset: () => ({ state: a }),
        },
        a: {
          reset: () => ({ state: b }),
        },
      },
    });

    actor.send(reset);
    expect(actor.state.name).toBe("b");

    actor.send(reset);
    expect(actor.state.name).toBe("a");
  });

  test("Any transition can emit internal events", () => {
    const toggle = event("toggled")();
    const internalEvent = event("internal")();
    const off = state("off")();
    const on = state("on")();
    let internalProcessed = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          toggled: () => ({
            emit: [internalEvent.create({})],
          }),
        },
        off: {
          internal: () => {
            internalProcessed = true;
            return { state: on };
          },
        },
      },
    });

    actor.send(toggle);
    expect(internalProcessed).toBe(true);
    expect(actor.state.name).toBe("on");
  });

  test("Any emit plus specific state transition both run", () => {
    const toggle = event("toggled")();
    const internalEvent = event("internal")();
    const off = state("off")();
    const on = state("on")();
    let anyFired = false;
    let internalProcessed = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internalEvent],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [() => {}],
      },
      transitions: {
        Any: {
          toggled: () => {
            anyFired = true;
            return { emit: [internalEvent.create({})] };
          },
        },
        off: {
          toggled: () => ({ state: on }),
        },
        on: {
          internal: () => {
            internalProcessed = true;
            return { state: off };
          },
        },
      },
    });

    actor.send(toggle);
    expect(anyFired).toBe(true);
    expect(internalProcessed).toBe(true);
  });

  test("Any with context mutation", () => {
    const reset = event("reset")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [reset],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        Any: {
          reset: (_event, { context }) => {
            (context as { count: number }).count++;
            return { state: on };
          },
        },
      },
    });

    actor.send(reset);
    expect(actor.context.count).toBe(1);
    expect(actor.state.name).toBe("on");
  });

  test("Any emit processed when state handler exists and returns state", () => {
    const clock = new VirtualClock();
    const trigger = event("trigger")();
    const internalEvt = event("internalEvt")();
    const idle = state("idle")();
    const processing = state("processing")();
    const done = state("done")();

    const actor = new Actor({
      inputs: [trigger],
      outputs: [],
      internal: [internalEvt],
      states: [idle, processing, done],
      initial: idle,
      context: {},
      clock,
      effects: {},
      transitions: {
        Any: {
          [trigger.id]: () => ({ emit: [internalEvt.create({})] }),
          [internalEvt.id]: () => ({ state: done }),
        },
        idle: {
          [trigger.id]: () => ({ state: processing }),
        },
      },
    });

    actor.send(trigger);

    expect(actor.state.name).toBe("done");
  });

  test("Any transitions fire from every state", () => {
    const reset = event("reset")();
    const go = event("go")();
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();

    const actor = new Actor({
      inputs: [reset, go],
      outputs: [],
      internal: [],
      context: {},
      states: [a, b, c],
      initial: a,
      effects: {},
      transitions: {
        Any: {
          reset: () => ({ state: a }),
        },
        a: {
          go: () => ({ state: b }),
        },
        b: {
          go: () => ({ state: c }),
        },
      },
    });

    actor.send(go);
    expect(actor.state.name).toBe("b");

    actor.send(reset);
    expect(actor.state.name).toBe("a");

    actor.send(go);
    actor.send(go);
    expect(actor.state.name).toBe("c");

    actor.send(reset);
    expect(actor.state.name).toBe("a");
  });
});
