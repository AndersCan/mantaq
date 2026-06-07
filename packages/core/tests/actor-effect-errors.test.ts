import { expect, test, describe, vi } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

describe("effect error handling", () => {
  test("thrown error sends to on('error') subscribers", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const errorHandler = vi.fn();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("effect failed");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", errorHandler);
    actor.send(toggle);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    expect((errorHandler.mock.calls[0][0] as Error).message).toBe("effect failed");
  });

  test("effect error does not crash the actor", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("boom");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", () => {});

    expect(() => actor.send(toggle)).not.toThrow();
    expect(actor.state.name).toBe("on");
  });

  test("actor continues processing after effect error", () => {
    const toggle = event("toggle")();
    const reset = event("reset")();
    const off = state("off")();
    const on = state("on")();
    const internalDone = event("done")();

    let internalProcessed = false;

    const actor = new Actor({
      inputs: [toggle, reset],
      outputs: [],
      internal: [internalDone],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("effect failed");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({
            state: on,
            emit: [internalDone.create({})],
          }),
        },
        on: {
          done: () => {
            internalProcessed = true;
            return { state: off };
          },
        },
      },
    });

    actor.on("error", () => {});
    actor.send(toggle);

    expect(internalProcessed).toBe(true);
    expect(actor.state.name).toBe("off");
  });

  test("multiple effects where one throws — others still run", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    let secondEffectRan = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("first effect failed");
          },
          () => {
            secondEffectRan = true;
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", () => {});
    actor.send(toggle);

    expect(secondEffectRan).toBe(true);
  });

  test("multiple errors all reported to subscribers", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const errors: unknown[] = [];

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("error 1");
          },
          () => {
            throw new Error("error 2");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", (err) => errors.push(err));
    actor.send(toggle);

    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toBe("error 1");
    expect((errors[1] as Error).message).toBe("error 2");
  });

  test("effect cleanup runs via abort signal on state change", () => {
    const toggle = event("toggle")();
    const advance = event("advance")();
    const off = state("off")();
    const on = state("on")();
    const done = state("done")();

    let cleanupCalled = false;

    const actor = new Actor({
      inputs: [toggle, advance],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on, done],
      initial: off,
      effects: {
        on: [
          ({ signal }) => {
            signal.addEventListener("abort", () => {
              cleanupCalled = true;
            });
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
        on: {
          advance: () => ({ state: done }),
        },
      },
    });

    actor.on("error", () => {});
    actor.send(toggle);
    expect(cleanupCalled).toBe(false);

    actor.send(advance);
    expect(cleanupCalled).toBe(true);
  });

  test("error in effect does not prevent state transition", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("effect error");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", () => {});
    actor.send(toggle);

    expect(actor.state.name).toBe("on");
  });

  test("error in effect with no subscribers does not throw", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw new Error("no subscriber error");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    expect(() => actor.send(toggle)).not.toThrow();
    expect(actor.state.name).toBe("on");
  });

  test("non-Error thrown from effect is reported", () => {
    const toggle = event("toggle")();
    const off = state("off")();
    const on = state("on")();
    const received: unknown[] = [];

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: {},
      states: [off, on],
      initial: off,
      effects: {
        on: [
          () => {
            throw "string error";
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
      },
    });

    actor.on("error", (err) => received.push(err));
    actor.send(toggle);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("string error");
  });

  test("error in effect with emit does not prevent emit processing", () => {
    const toggle = event("toggle")();
    const internal = event("internal")();
    const off = state("off")();
    const on = state("on")();
    const done = state("done")();

    let internalProcessed = false;

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [internal],
      context: {},
      states: [off, on, done],
      initial: off,
      effects: {
        on: [
          ({ emit }) => {
            emit(internal.create({}));
            throw new Error("effect error after emit");
          },
        ],
      },
      transitions: {
        off: {
          toggle: () => ({ state: on }),
        },
        on: {
          internal: () => {
            internalProcessed = true;
            return { state: done };
          },
        },
      },
    });

    actor.on("error", () => {});
    actor.send(toggle);

    expect(internalProcessed).toBe(true);
    expect(actor.state.name).toBe("done");
  });
});
