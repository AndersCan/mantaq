/* oxlint-disable oxlinter/comments-multiline-jsdoc -- ts-strict-casting requires a rationale line comment directly below each @ts-expect-error, and typescript requires line comments between the directive and the code */
import type { ErrorReason } from "./actor-types.ts";
import { Actor, state, event, Context, StateRef } from "./index.ts";
import type {
  ActorOptions,
  AnyStateRef,
  ErrorInfo,
  ErrorState,
  EventTypeOf,
  InternalEvent,
  PayloadOf,
  TransitionResult,
} from "./index.ts";
import { expect, expectTypeOf, test, describe } from "vite-plus/test";

describe("API type safety", () => {
  test("emit to output passes typecheck", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();
    const pong = event("PONG")();

    const actor = Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: clicked, handler: () => ({ emit: [pong.create()] }) });
      },
    });

    let received: Array<{ type: string }> = [];
    actor.on("output", {
      fn: (e) => {
        received.push(e);
      },
    });
    actor.send(clicked.create({ x: 3 }));
    expect({ count: received.length, type: received[0]?.type }).toEqual({
      count: 1,
      type: "PONG",
    });
  });

  test("an Any handler handles the event", () => {
    const idle = state("idle")();
    const active = state("active")();
    const triggered = event("TRIGGERED")();

    const actor = Actor({
      inputs: [triggered],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: triggered, handler: () => ({ state: active }) });
        m.onAny({ eventRef: triggered, handler: () => ({ state: idle }) });
      },
    });

    actor.send(triggered.create());
    expect(actor.snapshot().path[0]).toBe("active");
  });

  test("final() sets isFinal so the machine completes", () => {
    const pending = state("pending")();
    const done = state("done")().final();

    const complete = event("COMPLETE")();

    const actor = Actor({
      inputs: [complete],
      states: [pending, done],
      initial: pending,
      setup: (m) => {
        m.on(pending, { eventRef: complete, handler: () => ({ state: done }) });
      },
    });

    actor.send(complete.create());
    expect(actor.snapshot().done).toBe(true);
  });

  test("handlers treat the context type param correctly", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      setup: (m) => {
        m.on(idle, {
          eventRef: tick,
          handler: (_e, { context }) => {
            const current = context.get();
            context.set({ ...current, count: current.count + 1 });
            return {};
          },
        });
      },
    });

    actor.send(tick.create());
    expect(actor.context.count).toBe(1);
  });
});

describe("type level contract — type = behavior", () => {
  test("send validates its argument against the declared inputs", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    const actor = Actor({
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

  test("actor.state returns the declared states union", () => {
    const idle = state("idle")();
    const active = state("active")();

    const actor = Actor({
      inputs: [],
      states: [idle, active],
      initial: idle,
      setup: () => {},
    });

    expectTypeOf(actor.state.name).toEqualTypeOf<"idle" | "active" | "__error">();
    expectTypeOf(actor.state).toMatchTypeOf<StateRef<string, unknown, boolean>>();
    expectTypeOf(actor.state.isFinal).toEqualTypeOf<false | true>();
  });

  test("snapshot.error keeps its narrowed type on presence", () => {
    const idle = state("idle")();
    const actor = Actor({
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

  test("the states union adds the error state to actor.state", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    if (actor.state.name === "__error") {
      expectTypeOf(actor.state).toEqualTypeOf<ErrorState>();
    }
  });

  test("handler events keep the declared id and payload end to end", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: clicked,
          handler: (event) => {
            expectTypeOf(event).toEqualTypeOf<{ type: "CLICKED"; payload: { x: number } }>();
            return {};
          },
        });
      },
    });
  });

  test("handlers and effects treat the context type param correctly", () => {
    const idle = state("idle")();
    const tick = event("TICK")();

    const actor = Actor({
      inputs: [tick],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      setup: (m) => {
        m.on(idle, {
          eventRef: tick,
          handler: (_e, { context }) => {
            expectTypeOf(context).toEqualTypeOf<Context<{ count: number }>>();
            expectTypeOf(context.get()).toEqualTypeOf<{ count: number }>();
            return {};
          },
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

  test("effects treat the state's declared payload type correctly", () => {
    const idle = state("idle")();
    const loading = state("loading")<{ url: string }>();

    Actor({
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
            // suppressed: expectTypeOf(state.payload.nope).toBeUnknown(); — payload is the declared shape, not arbitrary keys
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

  test("final() sets isFinal to true at the type level", () => {
    const done = state("done")().final();
    const pending = state("pending")();

    expectTypeOf(done.isFinal).toEqualTypeOf<true>();
    expectTypeOf(pending.isFinal).toEqualTypeOf<false>();
  });

  test("wrong usage fails to compile", () => {
    const clicked = event("CLICKED")<{ x: number }>();
    const idle = state("idle")();

    const actor = Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: () => {},
    });

    // @ts-expect-error send takes an event object, not a bare string id
    // suppressed: actor.send("CLICKED"); — send takes an event object, not a bare string id
    actor.send("CLICKED");
    // @ts-expect-error created event requires the declared payload
    // suppressed: actor.send({ type: "CLICKED" }); — created event requires the declared payload
    actor.send({ type: "CLICKED" });

    const ready = state("ready")<{ items: string[] }>();
    // @ts-expect-error create requires the full payload
    // suppressed: ready.create({}); — create requires the full payload
    ready.create({});
  });

  test("inject, dispose and on('output') keep their types on the actor", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const off: () => void = actor.on("output", { fn: (_subscriberEvent: InternalEvent) => {} });
    void off;
    function injectSeam(subscriberEvent: InternalEvent) {
      actor.inject(subscriberEvent);
    }
    expectTypeOf(injectSeam).parameters.toEqualTypeOf<[InternalEvent]>();
    function disposeSeam() {
      actor.dispose();
    }
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

    Actor({
      inputs: [clicked, other],
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: clicked, handler: () => ({ state: active }) });
        // @ts-expect-error transition target must be a declared state
        // suppressed: m.on(idle, { eventRef: other, handler: () => ({ state: alien }) }); — transition target must be a declared state
        m.on(idle, { eventRef: other, handler: () => ({ state: alien }) });
      },
    });

    Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: (m) => {
        // @ts-expect-error emit id must be a declared output
        // suppressed: m.on(idle, { eventRef: clicked, handler: () => ({ emit: [{ type: "UNDE — emit id must be a declared output
        m.on(idle, { eventRef: clicked, handler: () => ({ emit: [{ type: "UNDECLARED_OUT" }] }) });
      },
    });
  });

  test("declared output carries through emit", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();
    const pong = event("PONG")<{ n: number }>();

    Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: clicked, handler: () => ({ emit: [pong.create({ n: 1 })] }) });
      },
    });
  });

  test("emit entries may carry a payload", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")();
    const pong = event("PONG")<{ n: number }>();

    Actor({
      inputs: [clicked],
      outputs: [pong],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, {
          eventRef: clicked,
          handler: () => ({ emit: [{ type: "PONG", payload: { n: 1 } }] }),
        });
      },
    });
  });
});

describe("public type surface — nameable helper types", () => {
  test("imports resolve for new public types", () => {
    const idle = state("idle")();
    const clicked = event("CLICKED")<{ x: number }>();

    Actor({
      inputs: [clicked],
      states: [idle],
      initial: idle,
      setup: () => {
        const result: TransitionResult<typeof idle, "PONG"> = {
          state: idle,
          emit: [{ type: "PONG" }],
        };
        void result;
        function handler(): TransitionResult<typeof idle, "PONG"> {
          return {};
        }
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

  test("on('done') callbacks reject arguments at the type level", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("done", { fn: () => {} });
    // @ts-expect-error done callbacks receive no arguments — (snapshot, prev) is a change callback
    // eslint-disable-next-line oxlinter/function-max-two-params
    actor.on("done", { fn: (_snap, _prev) => {} });
  });

  test("the on('transition') callback handles TransitionInfo", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("transition", {
      fn: (info) => {
        expectTypeOf(info.event).toEqualTypeOf<InternalEvent>();
        expectTypeOf(info.from).toBeString();
        expectTypeOf(info.to).toBeString();
        expectTypeOf(info.transitioned).toBeBoolean();
        expectTypeOf(info.effects).toEqualTypeOf<string[]>();
      },
    });
  });

  test("the on('error') callback handles ErrorInfo", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    actor.on("error", {
      fn: (info) => {
        expectTypeOf(info).toEqualTypeOf<ErrorInfo>();
        expectTypeOf(info.error).toBeUnknown();
        expectTypeOf(info.state).toEqualTypeOf<AnyStateRef>();
        expectTypeOf(info.context).toBeUnknown();
        expectTypeOf(info.event).toEqualTypeOf<InternalEvent>();
        expectTypeOf(info.reason).toEqualTypeOf<ErrorReason>();
      },
    });
    const unsub: () => void = actor.on("error", { fn: () => {} });
    expectTypeOf(unsub).toBeFunction();
    // @ts-expect-error error callbacks receive a single ErrorInfo — (snap, prev) is a change callback
    // eslint-disable-next-line oxlinter/function-max-two-params
    actor.on("error", { fn: (_snap, _prev) => {} });
    function badTag(): () => void {
      // @ts-expect-error the event tag is not free-form
      // suppressed: actor.on("nope", ...) — "nope" is not a declared subscriber event
      return actor.on("nope", () => {});
    }
    expectTypeOf(badTag).toBeFunction();
  });

  test("tests validate the snapshot payload as optional", () => {
    const idle = state("idle")();
    const actor = Actor({
      inputs: [],
      states: [idle],
      initial: idle,
      setup: () => {},
    });
    const snap = actor.snapshot();
    expectTypeOf(snap.payload).toEqualTypeOf<unknown>();
  });
});
/* oxlint-enable oxlinter/comments-multiline-jsdoc */
