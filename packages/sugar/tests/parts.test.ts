import { expect, test, describe, expectTypeOf } from "vite-plus/test";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { Context, ErrorState } from "@mantaq/core";
import { onOutput } from "../src/output.ts";
import { withTimeout } from "../src/effects/timeout.ts";
import { definePart, use, withParts } from "../src/parts.ts";

const idle = state("idle")();
const loading = state("loading")();
const done = state("done")().final();
const failed = state("failed")();
const wrongState = state("wrong")();

const start = event("start")();
const finish = event("finish")<{ value: number }>();
const fail = event("fail")<{ reason: string }>();
const slow = event("slow")();
const report = event("report")<{ value: number }>();

type LoadContext = { attempts: number; last?: string };

const load = {
  inputs: [start, fail, finish] as const,
  internal: [slow] as const,
  outputs: [report] as const,
  states: [idle, loading, done, failed] as const,
  initial: idle,
  context: {} as LoadContext,
};

function newLoad() {
  return { ...load, context: { attempts: 0 } as LoadContext };
}

const startPart = definePart<typeof load>((m) => {
  m.on(idle, start, (_event, opts) => {
    const cur = opts.context.get();
    cur.attempts += 1;
    opts.context.set(cur);
    return { state: loading };
  });
});

const finishPart = definePart<typeof load>((m) => {
  m.on(loading, finish, (event, opts) => {
    const cur = opts.context.get();
    cur.last = `v${event.payload.value}`;
    opts.context.set(cur);
    return { state: done, emit: [report.create({ value: event.payload.value })] };
  });
  m.on(loading, fail, (_event, _opts) => ({ state: failed }));
});

const retryPart = definePart<typeof load>((m) => {
  m.on(failed, start, (_event, opts) => {
    const cur = opts.context.get();
    cur.attempts += 1;
    opts.context.set(cur);
    return { state: loading };
  });
});

const timeoutPart = definePart<typeof load>((m) => {
  m.effect(loading, (input) => {
    withTimeout(5, input, () => slow.create());
  });
  m.on(loading, slow, (_event, _opts) => ({ state: failed }));
});

describe("definePart + use", () => {
  test("returns a builder closure that registers handlers", () => {
    const actor = new Actor({
      ...newLoad(),
      setup: (m) => {
        use(m, startPart);
        use(m, finishPart);
      },
    });
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    actor.send(finish.create({ value: 7 }));
    expect(actor.state).toBe(done);
    expect(actor.context.attempts).toBe(1);
    expect(actor.context.last).toBe("v7");
  });
});

describe("withParts", () => {
  test("composes parts into a working actor", () => {
    const actor = withParts(newLoad(), [startPart, finishPart]);
    expect(actor.state).toBe(idle);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    actor.send(finish.create({ value: 3 }));
    expect(actor.state).toBe(done);
    expect(actor.context.last).toBe("v3");
  });

  test("parts can reference each other's states", () => {
    const actor = withParts(newLoad(), [startPart, finishPart, retryPart]);
    actor.send(start.create());
    actor.send(fail.create({ reason: "boom" }));
    expect(actor.state).toBe(failed);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    expect(actor.context.attempts).toBe(2);
  });

  test("emits from parts flow through declared outputs", () => {
    const actor = withParts(newLoad(), [startPart, finishPart]);
    const received: Array<{ type: string; payload?: unknown }> = [];
    onOutput(actor, (e) => received.push(e));
    actor.send(start.create());
    actor.send(finish.create({ value: 3 }));
    expect(received).toEqual([{ type: "report", payload: { value: 3 } }]);
  });

  test("effects registered in parts run on state entry", async () => {
    const clock = new VirtualClock();
    const actor = withParts({ ...newLoad(), clock }, [startPart, timeoutPart, finishPart]);
    actor.send(start.create());
    expect(actor.state).toBe(loading);
    clock.advance(5);
    await actor.settled();
    expect(actor.state).toBe(failed);
  });

  test("onAny parts handle events in any state", () => {
    const toggle = event("toggle")();
    const on = state("on")();
    const off = state("off")();
    const lamp = {
      inputs: [toggle] as const,
      internal: [] as const,
      states: [on, off] as const,
      initial: off,
      context: { flips: 0 },
    };
    const flipPart = definePart<typeof lamp>((m) => {
      m.on(off, toggle, () => ({ state: on }));
      m.on(on, toggle, () => ({ state: off }));
      m.onAny(toggle, (_event, opts) => {
        const cur = opts.context.get();
        cur.flips += 1;
        opts.context.set(cur);
        return {};
      });
    });
    const actor = withParts(lamp, [flipPart]);
    actor.send(toggle.create());
    expect(actor.state).toBe(on);
    actor.send(toggle.create());
    expect(actor.state).toBe(off);
    expect(actor.context.flips).toBe(2);
  });
});

describe("parts keep full types", () => {
  test("handlers see typed events and context", () => {
    definePart<typeof load>((m) => {
      m.on(loading, finish, (event, opts) => {
        expectTypeOf(event.payload).toEqualTypeOf<{ value: number }>();
        expectTypeOf(opts.context).toEqualTypeOf<Context<LoadContext>>();
        expectTypeOf(opts.context.get().attempts).toEqualTypeOf<number>();
        return { state: done, emit: [report.create({ value: event.payload.value })] };
      });
    });
  });

  test("wrong transition target is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(idle, start, () => ({
        // @ts-expect-error "wrong" is not a declared state
        state: wrongState,
      }));
    });
  });

  test("wrong event payload access is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(loading, finish, (event) => {
        // @ts-expect-error finish payload has no "nope"
        const nope: number = event.payload.nope;
        void nope;
        return { state: done };
      });
    });
  });

  test("wrong context key is a compile error", () => {
    definePart<typeof load>((m) => {
      m.on(idle, start, (_event, opts) => {
        // @ts-expect-error LoadContext has no "nope"
        const nope: number = opts.context.get().nope;
        void nope;
        return { state: loading };
      });
    });
  });

  test("emit is rejected when the machine declares no outputs", () => {
    const silent = {
      inputs: [start] as const,
      internal: [] as const,
      states: [idle, loading] as const,
      initial: idle,
    };
    definePart<typeof silent>((m) => {
      m.on(idle, start, () => ({
        state: loading,
        // @ts-expect-error no outputs declared, so emit is not allowed
        emit: [report.create({ value: 1 })],
      }));
    });
  });

  test("withParts infers the actor's context and state types", () => {
    const actor = withParts(load, [startPart]);
    expectTypeOf(actor.context).toEqualTypeOf<LoadContext>();
    expectTypeOf(actor.state).toEqualTypeOf<
      typeof idle | typeof loading | typeof done | typeof failed | ErrorState
    >();
  });

  test("a part built for another machine is a compile error", () => {
    const other = {
      inputs: [start] as const,
      internal: [] as const,
      states: [idle] as const,
      initial: idle,
    };
    definePart<typeof other>((m) => {
      m.on(idle, start, () => ({
        // @ts-expect-error "done" is not a state of the other machine
        state: done,
      }));
    });
  });
});
