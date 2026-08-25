import { expect, test, describe } from "vite-plus/test";
import { VirtualClock, Context, event, state } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";
import { actorSpec, definePart, withParts } from "../src/parts.ts";

describe("withTimeout", () => {
  test("emits event after specified ms", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e: { type: string; [key: string]: unknown }) => emitted.push(e),
        clock,
      },
      () => ({ type: "timeout" }),
    );

    clock.advance(99);
    expect(emitted).toEqual([]);

    clock.advance(1);
    expect(emitted).toEqual([{ type: "timeout" }]);
  });

  test("does not emit if timer aborted before fire", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e: { type: string; [key: string]: unknown }) => emitted.push(e),
        clock,
      },
      () => ({ type: "timeout" }),
    );

    abort.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("does not emit if signal already aborted", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();
    abort.abort();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e: { type: string; [key: string]: unknown }) => emitted.push(e),
        clock,
      },
      () => ({ type: "timeout" }),
    );

    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("emits correct event payload", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      50,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e: { type: string; [key: string]: unknown }) => emitted.push(e),
        clock,
      },
      () => ({ type: "customTimeout", reason: "exceeded" }),
    );

    clock.advance(50);
    expect(emitted).toEqual([{ type: "customTimeout", reason: "exceeded" }]);
  });

  test("does not emit after advance if aborted later", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e: { type: string; [key: string]: unknown }) => emitted.push(e),
        clock,
      },
      () => ({ type: "timeout" }),
    );

    clock.advance(50);
    abort.abort();
    clock.advance(100);
    expect(emitted).toEqual([]);
  });

  test("aborting removes the scheduled timer from the clock", () => {
    const clock = new VirtualClock();
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: () => {},
        clock,
      },
      () => ({ type: "timeout" }),
    );
    expect(clock.hasPending()).toBe(true);
    abort.abort();
    expect(clock.hasPending()).toBe(false);
  });
});

/**
 * Regression coverage for the reported timer-leak in `withTimeout` (#242).
 * Each scenario asserts the one-shot timer is gone once it can no longer
 * fire — on the happy path (after it fires), on an actor transition away
 * from the owning state (the effect signal is aborted), and on dispose.
 * The clock removes one-shot timers after firing and on signal abort, so a
 * scheduled `withTimeout` must never linger.
 */
describe("withTimeout — timer lifecycle", () => {
  const idle = state("idle")();
  const loading = state("loading")();
  const done = state("done")().final();
  const failed = state("failed")();
  const start = event("start")();
  const finish = event("finish")();
  const slow = event("slow")();

  const spec = actorSpec({
    inputs: [start, finish],
    internal: [slow],
    outputs: [],
    states: [idle, loading, done, failed],
    initial: idle,
    context: {},
  });

  const startPart = definePart<typeof spec>((m) => {
    m.on(idle, start, () => ({ state: loading }));
  });
  const timeoutPart = definePart<typeof spec>((m) => {
    m.effect(loading, {
      name: "startTimeoutTimer",
      fn: (input) => {
        withTimeout(1000, input, () => slow.create());
      },
    });
    m.on(loading, slow, () => ({ state: failed }));
  });
  const toDonePart = definePart<typeof spec>((m) => {
    m.on(loading, finish, () => ({ state: done }));
  });

  test("timer is removed from the clock after it fires (no dangling timer on the happy path)", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: new Context(
          () => undefined,
          () => {},
        ),
        emit: (e) => emitted.push(e as { type: string }),
        clock,
      },
      () => ({ type: "timeout" }),
    );

    expect(clock.hasPending()).toBe(true);
    clock.advance(100);
    expect(emitted).toEqual([{ type: "timeout" }]);
    // One-shot timer must be removed once it has fired.
    expect(clock.hasPending()).toBe(false);
  });

  test("actor transition away from the timer's state clears the pending timer", () => {
    const clock = new VirtualClock();
    const actor = withParts({ ...spec, clock }, [startPart, timeoutPart, toDonePart]);

    actor.send(start.create()); // idle -> loading: schedules the timeout
    expect(clock.hasPending()).toBe(true);

    actor.send(finish.create()); // loading -> done: effect signal is aborted
    expect(clock.hasPending()).toBe(false);
  });

  test("disposing the actor clears a pending timer", () => {
    const clock = new VirtualClock();
    const actor = withParts({ ...spec, clock }, [startPart, timeoutPart, toDonePart]);

    actor.send(start.create());
    expect(clock.hasPending()).toBe(true);

    actor.dispose();
    expect(clock.hasPending()).toBe(false);
  });
});
