import { event } from "./event.ts";
import { Actor, VirtualClock } from "./index.ts";
import { state } from "./state.ts";
import { expect, test, describe } from "vite-plus/test";

/**
 * A handler/subscriber explosion is a programmer bug, i.e. an assert-style bad
 * state, so the containment paths below use a guard-shaped throw helper.
 */
function isErrorBomb(message: string): never {
  throw new Error(message);
}

describe("recover() resource cleanup", () => {
  test("the actor handles recover() by aborting the in-flight effect's AbortController (#206)", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    const tick = event("TICK")();
    const clock = VirtualClock();
    let effectSignal: AbortSignal | undefined;
    let lateEmits = 0;

    const actor = Actor({
      clock,
      inputs: [trigger, boom, tick],
      internal: [tick],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "scheduleLateEmit",
          fn: ({ signal, emit }) => {
            effectSignal = signal;
            return new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve());
              clock.setTimeout(1000, {
                signal,
                cb: () => {
                  lateEmits++;
                  emit(tick.create());
                  resolve();
                },
              });
            });
          },
        });
        m.on(loading, { eventRef: boom, handler: () => isErrorBomb("boom") });
        m.on(loading, { eventRef: tick, handler: () => ({ state: idle }) });
      },
    });

    actor.send(trigger.create());
    expect({ state: actor.snapshot().path[0], aborted: effectSignal?.aborted }).toEqual({
      state: "loading",
      aborted: false,
    });

    actor.send(boom.create());
    const deadState = actor.snapshot().path[0];
    expect(deadState).toBe("__error");

    actor.recover({ state: loading, context: {} });
    const recoveredState = actor.snapshot().path[0];
    expect(recoveredState).toBe("loading");

    /**
     * recover() must abort the in-flight effect's controller so a late-firing
     * async effect can no longer re-enter the error state.
     */
    const abortedAfterRecover = effectSignal?.aborted;
    expect({ aborted: abortedAfterRecover }).toEqual({ aborted: true });

    // The armed timer is cleared by the abort, so no late emit fires.
    clock.advance(5000);
    expect(lateEmits).toBe(0);
    const finalSnap = actor.snapshot();
    expect({ state: finalSnap.path[0], error: finalSnap.error }).toEqual({
      state: "loading",
      error: undefined,
    });
  });

  test("#203: recover() resolves an in-flight settled() await instead of hanging", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const trigger = event("GO")();
    const boom = event("BOOM")();
    const clock = VirtualClock();

    const actor = Actor({
      clock,
      inputs: [trigger, boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, { eventRef: trigger, handler: () => ({ state: loading }) });
        m.effect(loading, {
          name: "resolveOnAbort",
          fn: ({ signal }) => {
            return new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve());
              clock.setTimeout(1000, { signal, cb: () => resolve() });
            });
          },
        });
        m.on(loading, { eventRef: boom, handler: () => isErrorBomb("boom") });
      },
    });

    actor.send(trigger.create());
    const runningState = actor.snapshot().path[0];
    expect(runningState).toBe("loading");

    // An in-flight await on settled() resolves against the current queue's resolvers.
    const settledPromise = actor.settled();
    const hangTimeout = new Promise<"hang">((resolve) => setTimeout(() => resolve("hang"), 500));

    actor.send(boom.create());
    const deadState = actor.snapshot().path[0];
    expect(deadState).toBe("__error");

    actor.recover({ state: idle, context: {} });
    const recoveredState = actor.snapshot().path[0];
    expect(recoveredState).toBe("idle");

    const result = await Promise.race([settledPromise, hangTimeout]);
    expect(result).not.toBe("hang");
  });
});
