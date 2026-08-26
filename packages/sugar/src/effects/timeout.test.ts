import { actorSpec, definePart, withParts } from "../parts.ts";
import { withTimeout } from "./timeout.ts";
import { VirtualClock, Context, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

describe("withTimeout", () => {
  test("emits the event after the given duration", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent: { type: string; [key: string]: unknown }) =>
          emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "timeout" }),
    });

    clock.advance(99);
    expect(emitted).toEqual([]);

    clock.advance(1);
    expect(emitted).toEqual([{ type: "timeout" }]);
  });

  test("does not emit if the timer aborted before firing", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent: { type: string; [key: string]: unknown }) =>
          emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "timeout" }),
    });

    abort.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("does not emit if the signal was already aborted", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();
    abort.abort();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent: { type: string; [key: string]: unknown }) =>
          emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "timeout" }),
    });

    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("emits the correct event payload", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(50, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent: { type: string; [key: string]: unknown }) =>
          emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "customTimeout", reason: "exceeded" }),
    });

    clock.advance(50);
    expect(emitted).toEqual([{ type: "customTimeout", reason: "exceeded" }]);
  });

  test("does not emit after advancing if aborted later", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent: { type: string; [key: string]: unknown }) =>
          emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "timeout" }),
    });

    clock.advance(50);
    abort.abort();
    clock.advance(100);
    expect(emitted).toEqual([]);
  });

  test("removes the scheduled timer from the clock on abort", () => {
    const clock = VirtualClock();
    const abort = new AbortController();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: () => {},
        clock,
      },
      event: () => ({ type: "timeout" }),
    });
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
    m.on(idle, { eventRef: start, handler: () => ({ state: loading }) });
  });
  const timeoutPart = definePart<typeof spec>((m) => {
    m.effect(loading, {
      name: "startTimeoutTimer",
      fn: (input) => {
        withTimeout(1000, { input, event: () => slow.create() });
      },
    });
    m.on(loading, { eventRef: slow, handler: () => ({ state: failed }) });
  });
  const toDonePart = definePart<typeof spec>((m) => {
    m.on(loading, { eventRef: finish, handler: () => ({ state: done }) });
  });

  test("deletes the fired one-shot timer from the clock (no dangling timer on the happy path)", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string }> = [];
    const abort = new AbortController();

    withTimeout(100, {
      input: {
        signal: abort.signal,
        state: { name: "", payload: undefined },
        event: { type: "" },
        context: Context({ get: () => undefined, set: () => {} }),
        emit: (emittedEvent) => emitted.push(emittedEvent),
        clock,
      },
      event: () => ({ type: "timeout" }),
    });

    expect(clock.hasPending()).toBe(true);
    clock.advance(100);
    expect(emitted).toEqual([{ type: "timeout" }]);
    // One-shot timer must be removed once it has fired.
    expect(clock.hasPending()).toBe(false);
  });

  test("deletes the pending timer when the actor transitions away from the timer's state", () => {
    const clock = VirtualClock();
    const actor = withParts({ ...spec, clock }, startPart, timeoutPart, toDonePart);

    actor.send(start.create()); // idle -> loading: schedules the timeout
    expect(clock.hasPending()).toBe(true);

    actor.send(finish.create()); // loading -> done: effect signal is aborted
    expect(clock.hasPending()).toBe(false);
  });

  test("deletes a pending timer when the actor disposes", () => {
    const clock = VirtualClock();
    const actor = withParts({ ...spec, clock }, startPart, timeoutPart, toDonePart);

    actor.send(start.create());
    expect(clock.hasPending()).toBe(true);

    actor.dispose();
    expect(clock.hasPending()).toBe(false);
  });
});
