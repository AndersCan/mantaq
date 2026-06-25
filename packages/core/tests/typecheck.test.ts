import { expect, test, describe } from "vite-plus/test";
import { Actor, state, event } from "../src/index.ts";

describe("API type safety", () => {
  test("emit to output passes typecheck", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();

    const actor = new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      transitions: {
        idle: {
          CLICKED: () => ({ emit: [{ id: "PONG" }] }),
        },
      },
    });

    let received: Array<{ id: string }> = [];
    actor.__outputHandler = (e) => {
      received.push(e);
    };
    actor.send(clicked.create({ x: 3 }));
    expect(received.length).toBe(1);
    expect(received[0].id).toBe("PONG");
  });

  test("Any handler transitions", () => {
    const idle = state("idle")();
    const active = state("active")();
    const triggered = event("TRIGGERED")();

    const actor = new Actor({
      inputs: [triggered],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: { TRIGGERED: () => ({ state: active }) },
        Any: { TRIGGERED: () => ({ state: idle }) },
      },
    });

    actor.send(triggered.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("final state assignment works", () => {
    const pending = state("pending")();
    const done = state("done")().final();

    const complete = event("COMPLETE")();

    const actor = new Actor({
      inputs: [complete],
      states: [pending, done],
      initial: pending,
      transitions: { pending: { COMPLETE: () => ({ state: done }) } },
    });

    actor.send(complete.create());
    expect(actor.snapshot().done).toBe(true);
  });

  test("context typed", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      transitions: {
        idle: {
          TICK: (_e, { context }) => {
            context.count++;
            return {};
          },
        },
      },
    });

    actor.send(tick.create());
    expect(actor.context.count).toBe(1);
  });
});
