import { expect, test, describe } from "vite-plus/test";
import { Actor } from "../src/actor.ts";
import { event } from "../src/event.ts";
import { state } from "../src/state.ts";

describe("context", () => {
  test("context is accessible via actor.context after initialization", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggled: () => ({ state: on }) },
      },
    });

    expect(actor.context.count).toBe(0);
  });

  test("context defaults to empty object when not provided", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: { toggled: () => ({ state: on }) },
      },
    });

    expect(actor.context).toEqual({});
  });

  test("context can be mutated in transition handlers", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: (_event, { context }) => {
            (context as { count: number }).count = 42;
            return { state: on };
          },
        },
      },
    });

    actor.send(toggle);
    expect(actor.context.count).toBe(42);
  });

  test("context mutation persists across transitions", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: (_event, { context }) => {
            (context as { count: number }).count += 1;
            return { state: on };
          },
        },
        on: {
          toggled: (_event, { context }) => {
            (context as { count: number }).count += 10;
            return { state: off };
          },
        },
      },
    });

    actor.send(toggle);
    expect(actor.context.count).toBe(1);

    actor.send(toggle);
    expect(actor.context.count).toBe(11);
  });

  test("context is available in effects", () => {
    let capturedContext: unknown;
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { value: "hello" },
      states: [off, on],
      initial: off,
      effects: {
        on: [
          ({ context }) => {
            capturedContext = context;
          },
        ],
      },
      transitions: {
        off: { toggled: () => ({ state: on }) },
      },
    });

    actor.send(toggle);
    expect(capturedContext).toEqual({ value: "hello" });
  });

  test("context mutated in effects is visible on actor.context", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { count: 0 },
      states: [off, on],
      initial: off,
      effects: {
        on: [
          ({ context }) => {
            (context as { count: number }).count = 99;
          },
        ],
      },
      transitions: {
        off: { toggled: () => ({ state: on }) },
      },
    });

    actor.send(toggle);
    expect(actor.context.count).toBe(99);
  });

  test("multiple context fields can be updated independently", () => {
    const toggle = event("toggled")();
    const ping = event("ping")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle, ping],
      outputs: [],
      internal: [],
      context: { name: "", active: false, score: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: (_event, { context }) => {
            const ctx = context as { name: string; active: boolean; score: number };
            ctx.name = "actor-1";
            ctx.active = true;
            return { state: on };
          },
        },
        on: {
          ping: (_event, { context }) => {
            (context as { name: string; active: boolean; score: number }).score = 100;
            return { state: on };
          },
        },
      },
    });

    actor.send(toggle);
    expect(actor.context.name).toBe("actor-1");
    expect(actor.context.active).toBe(true);
    expect(actor.context.score).toBe(0);

    actor.send(ping);
    expect(actor.context.name).toBe("actor-1");
    expect(actor.context.active).toBe(true);
    expect(actor.context.score).toBe(100);
  });

  test("context mutation visible to subsequent sends", () => {
    const toggle = event("toggled")();
    const off = state("off")();
    const on = state("on")();

    const actor = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      context: { visited: 0 },
      states: [off, on],
      initial: off,
      effects: {},
      transitions: {
        off: {
          toggled: (_event, { context }) => {
            (context as { visited: number }).visited += 1;
            return { state: on };
          },
        },
        on: {
          toggled: (_event, { context }) => {
            (context as { visited: number }).visited += 1;
            return { state: off };
          },
        },
      },
    });

    actor.send(toggle);
    actor.send(toggle);
    actor.send(toggle);
    expect(actor.context.visited).toBe(3);
  });
});
