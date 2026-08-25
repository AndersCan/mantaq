import { expect, expectTypeOf, test, describe } from "vite-plus/test";
import { Actor, state, event, Context } from "../src/index.ts";
import type {
  StateRef,
  ErrorInfo,
  ErrorState,
  InternalEvent,
  AnyStateRef,
  TransitionResult,
  TransitionHandler,
  ActorOptions,
  PayloadOf,
  EventTypeOf,
} from "../src/index.ts";
import type { ErrorReason } from "../src/actor-types.ts";

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

    let received: Array<{ type: string }> = [];
    actor.on("output", (e) => {
      received.push(e);
    });
    actor.send(clicked.create({ x: 3 }));
    expect(received.length).toBe(1);
    expect(received[0].type).toBe("PONG");
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
          const s = context.get();
          context.set({ ...s, count: s.count + 1 });
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

    expectTypeOf<Parameters<typeof actor.send>[0]>().toEqualTypeOf<{
      type: "CLICKED";
      payload: { x: number };
    }>();
    expectTypeOf<ReturnType<typeof clicked.create>>().toEqualTypeOf<{
      type: "CLICKED";
      payload: { x: number };
    }>();
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

    expectTypeOf(actor.state.name).toEqualTypeOf<"idle" | "active" | "__error">();
    expectTypeOf(actor.state).toMatchTypeOf<StateRef<string, unknown, boolean>>();
    expectTypeOf(actor.state.isFinal).toEqualTypeOf<false | true>();
  });

  test("snapshot.error narrows on presence", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const snap = actor.snapshot();
    if (snap.error) {
      expectTypeOf(snap.error).toEqualTypeOf<ErrorInfo>();
      expectTypeOf(snap.error.reason).toEqualTypeOf<ErrorReason>();
      expectTypeOf(snap.error.state).toEqualTypeOf<AnyStateRef>();
      expectTypeOf(snap.error.event).toEqualTypeOf<InternalEvent>();
    } else {
      expectTypeOf(snap.error).toBeUndefined();
    }
  });

  test("actor.state can be the error state", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    if (actor.state.name === "__error") {
      expectTypeOf(actor.state).toEqualTypeOf<ErrorState>();
    }
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
          expectTypeOf(event).toEqualTypeOf<{ type: "CLICKED"; payload: { x: number } }>();
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
          expectTypeOf(context).toEqualTypeOf<Context<{ count: number }>>();
          expectTypeOf(context.get()).toEqualTypeOf<{ count: number }>();
          return {};
        });
        m.effect(idle, {
          name: "readContext",
          fn: ({ context }) => {
            expectTypeOf(context).toEqualTypeOf<Context<{ count: number }>>();
            expectTypeOf(context.get()).toEqualTypeOf<{ count: number }>();
          },
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

  test("effect receives the state's declared payload type", () => {
    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();

    new Actor({
      inputs: [],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.effect(loading, {
          name: "readPayload",
          fn: ({ state }) => {
            expectTypeOf(state.payload).toEqualTypeOf<{ url: string }>();
            expectTypeOf(state.payload.url).toBeString();
            // @ts-expect-error payload is the declared shape, not arbitrary keys
            expectTypeOf(state.payload.nope).toBeUnknown();
          },
        });
        // a state without a payload generic keeps payload unknown
        m.effect(idle, {
          name: "observePayload",
          fn: ({ state }) => {
            expectTypeOf(state.payload).toBeUnknown();
          },
        });
      },
    });
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
    actor.send({ type: "CLICKED" });

    const ready = state("ready")<{ items: string[] }>();
    // @ts-expect-error create requires the full payload
    ready.create({});
  });

  test("inject, dispose and on('output') are typed on the actor", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const off: () => void = actor.on("output", (_e: InternalEvent) => {});
    void off;
    const injectSeam = (e: InternalEvent) => actor.inject(e);
    expectTypeOf(injectSeam).parameters.toEqualTypeOf<[InternalEvent]>();
    const disposeSeam = () => actor.dispose();
    expectTypeOf(disposeSeam).toBeFunction();
  });
});

describe("transition contract — type = behavior", () => {
  test("transition target and emit id must be declared", () => {
    const idle = state("idle")();
    const active = state("active")();
    const alien = state("alien")();
    const clicked = event("CLICKED")();
    const other = event("OTHER")();

    new Actor({
      inputs: [clicked, other],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, () => ({ state: active }));
        // @ts-expect-error transition target must be a declared state
        m.on(idle, other, () => ({ state: alien }));
      },
    });

    new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: (m) => {
        // @ts-expect-error emit id must be a declared output
        m.on(idle, clicked, () => ({ emit: [{ type: "UNDECLARED_OUT" }] }));
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

  test("emit entries may carry a payload", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")();
    const pong = event("PONG")<{ n: number }>();

    new Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, clicked, () => ({ emit: [{ type: "PONG", payload: { n: 1 } }] }));
      },
    });
  });
});

describe("public type surface — nameable helper types", () => {
  test("new public types are exported and nameable", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();

    new Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: () => {
        const result: TransitionResult<typeof idle, "PONG"> = {
          state: idle,
          emit: [{ type: "PONG" }],
        };
        void result;
        const handler: TransitionHandler<[typeof idle], { n: number }> = () => ({});
        void handler;
        const opts: ActorOptions<[typeof idle], [typeof clicked], [], [], { n: number }> = {
          inputs: [clicked],
          states: [idle],
          initial: idle,
          context: { n: 1 },
          setup: (b) => void b,
        };
        void opts;
      },
    });

    type P = PayloadOf<typeof idle>;
    expectTypeOf<P>().toEqualTypeOf<unknown>();
    type E = EventTypeOf<typeof clicked>;
    expectTypeOf<E>().toEqualTypeOf<"CLICKED">();
  });

  test("on('done') callbacks must take no arguments", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("done", () => {});
    // @ts-expect-error done callbacks receive no arguments — (snapshot, prev) is a change callback
    actor.on("done", (_snap, _prev) => {});
  });

  test("on('transition') callback receives TransitionInfo", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("transition", (info) => {
      expectTypeOf(info.event).toEqualTypeOf<InternalEvent>();
      expectTypeOf(info.from).toBeString();
      expectTypeOf(info.to).toBeString();
      expectTypeOf(info.transitioned).toBeBoolean();
      expectTypeOf(info.effects).toEqualTypeOf<string[]>();
    });
  });

  test("on('error') callback receives ErrorInfo", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("error", (info) => {
      expectTypeOf(info).toEqualTypeOf<ErrorInfo>();
      expectTypeOf(info.error).toBeUnknown();
      expectTypeOf(info.state).toEqualTypeOf<AnyStateRef>();
      expectTypeOf(info.context).toBeUnknown();
      expectTypeOf(info.event).toEqualTypeOf<InternalEvent>();
      expectTypeOf(info.reason).toEqualTypeOf<ErrorReason>();
    });
    const unsub: () => void = actor.on("error", () => {});
    expectTypeOf(unsub).toBeFunction();
    // @ts-expect-error error callbacks receive a single ErrorInfo — (snap, prev) is a change callback
    actor.on("error", (_snap, _prev) => {});
    // @ts-expect-error the event tag is not free-form
    const badTag = (): (() => void) => actor.on("nope", () => {});
    expectTypeOf(badTag).toBeFunction();
  });

  test("snapshot payload is observable and optional", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const snap = actor.snapshot();
    expectTypeOf(snap.payload).toEqualTypeOf<unknown>();
  });
});
