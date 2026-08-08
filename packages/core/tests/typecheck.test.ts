import { expect, expectTypeOf, test, describe } from "vite-plus/test";
import { Actor, state, event } from "../src/index.ts";
import type { StateRef } from "../src/index.ts";

describe("API type safety", () => {
  test("emit to output passes typecheck", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();
    const pong = event("PONG")();

    const actor = new Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, () => ({ emit: [pong.create()] }));
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
      setup: (m) => {
        m.on(idle, triggered, () => ({ state: active }));
        m.onAny(triggered, () => ({ state: idle }));
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
      setup: (m) => {
        m.on(pending, complete, () => ({ state: done }));
      },
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
      setup: (m) => {
        m.on(idle, tick, (_e, { context }) => {
          context.count++;
          return {};
        });
      },
    });

    actor.send(tick.create());
    expect(actor.context.count).toBe(1);
  });
});

describe("type level contract — type = behavior", () => {
  test("send accepts exactly the created event of a declared input", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    const actor = new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: () => {},
    });

    expectTypeOf<Parameters<typeof actor.send>[0]>().toEqualTypeOf<
      { x: number } & { id: "CLICKED" }
    >();
    expectTypeOf<ReturnType<typeof clicked.create>>().toEqualTypeOf<
      { x: number } & { id: "CLICKED" }
    >();
  });

  test("state is the declared states union", () => {
    const idle = state("idle")();
    const active = state("active")();

    const actor = new Actor({
      inputs: [],
      states: [idle, active],
      initial: idle,
      setup: () => {},
    });

    expectTypeOf(actor.state.name).toEqualTypeOf<"idle" | "active">();
    expectTypeOf(actor.state).toMatchTypeOf<StateRef<string>>();
  });

  test("handler event carries declared id and payload end to end", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, (event) => {
          expectTypeOf(event).toEqualTypeOf<{ x: number } & { id: "CLICKED" }>();
          return {};
        });
      },
    });
  });

  test("context flows typed into handlers and effects", () => {
    const idle = state("idle")();
    const tick = event("TICK")();

    const actor = new Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      setup: (m) => {
        m.on(idle, tick, (_e, { context }) => {
          expectTypeOf(context).toEqualTypeOf<{ count: number }>();
          return {};
        });
        m.effect(idle, ({ context }) => {
          expectTypeOf(context).toEqualTypeOf<{ count: number }>();
        });
      },
    });

    expectTypeOf(actor.context).toEqualTypeOf<{ count: number }>();
  });

  test("state payload is typed through create", () => {
    const ready = state("ready")<{ items: string[] }>();

    const created = ready.create({ items: ["a"] });
    expectTypeOf(created.payload).toEqualTypeOf<{ items: string[] }>();
    expectTypeOf(created.state).toMatchTypeOf<StateRef<"ready", { items: string[] }>>();
  });

  test("final() narrows isFinal to true", () => {
    const done = state("done")().final();
    const pending = state("pending")();

    expectTypeOf(done.isFinal).toEqualTypeOf<true>();
    expectTypeOf(pending.isFinal).toEqualTypeOf<false>();
  });

  test("wrong usage fails to compile", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    const actor = new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: () => {},
    });

    // @ts-expect-error send takes an event object, not a bare string id
    actor.send("CLICKED");
    // @ts-expect-error created event requires the declared payload
    actor.send({ id: "CLICKED" });

    const ready = state("ready")<{ items: string[] }>();
    // @ts-expect-error create requires the full payload
    ready.create({});
  });
});

describe("transition contract — type = behavior", () => {
  test("transition target and emit id must be declared", () => {
    const idle = state("idle")();
    const active = state("active")();
    const alien = state("alien")();
    const clicked = event("CLICKED")();

    new Actor({
      inputs: [clicked],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, () => ({ state: active }));
        // @ts-expect-error transition target must be a declared state
        m.on(idle, clicked, () => ({ state: alien }));
      },
    });

    new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: (m) => {
        // @ts-expect-error emit id must be a declared output
        m.on(idle, clicked, () => ({ emit: [{ id: "UNDECLARED_OUT" }] }));
      },
    });
  });

  test("declared output carries through emit", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();
    const pong = event("PONG")<{ n: number }>();

    new Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, () => ({ emit: [pong.create({ n: 1 })] }));
      },
    });
  });
});
