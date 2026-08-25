import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock } from "../src/index.ts";
import { state } from "../src/state.ts";
import { event } from "../src/event.ts";

describe("recover() resource cleanup", () => {
  test("#206: recover() aborts the in-flight effect's AbortController", () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const boom = event("BOOM")();
    const tick = event("TICK")();
    const clock = new VirtualClock();
    let effectSignal: AbortSignal | undefined;
    let lateEmits = 0;

    const actor = new Actor({
      clock,
      inputs: [go, boom, tick],
      internal: [tick],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "scheduleLateEmit",
          fn: ({ signal, emit }) => {
            effectSignal = signal;
            return new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve());
              clock.setTimeout(
                1000,
                () => {
                  lateEmits++;
                  emit(tick.create());
                  resolve();
                },
                { signal },
              );
            });
          },
        });
        m.on(loading, boom, () => {
          throw new Error("boom");
        });
        m.on(loading, tick, () => ({ state: idle }));
      },
    });

    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("loading");
    expect(effectSignal?.aborted).toBe(false);

    actor.send(boom.create());
    expect(actor.snapshot().path[0]).toBe("__error");

    actor.recover({ state: loading, context: {} });
    expect(actor.snapshot().path[0]).toBe("loading");

    // recover() must abort the in-flight effect's controller so a late-firing
    // async effect can no longer re-enter the error state.
    expect(effectSignal?.aborted).toBe(true);

    // The armed timer is cleared by the abort, so no late emit fires.
    clock.advance(5000);
    expect(lateEmits).toBe(0);
    expect(actor.snapshot().path[0]).toBe("loading");
    expect(actor.snapshot().error).toBeUndefined();
  });

  test("#203: recover() resolves an in-flight settled() await instead of hanging", async () => {
    const idle = state("idle")();
    const loading = state("loading")();
    const go = event("GO")();
    const boom = event("BOOM")();
    const clock = new VirtualClock();

    const actor = new Actor({
      clock,
      inputs: [go, boom],
      states: [idle, loading],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: loading }));
        m.effect(loading, {
          name: "resolveOnAbort",
          fn: ({ signal }) => {
            return new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve());
              clock.setTimeout(1000, () => resolve(), { signal });
            });
          },
        });
        m.on(loading, boom, () => {
          throw new Error("boom");
        });
      },
    });

    actor.send(go.create());
    expect(actor.snapshot().path[0]).toBe("loading");

    // An in-flight await on settled() resolves against the current queue's resolvers.
    const settledPromise = actor.settled();
    const hangTimeout = new Promise<"hang">((resolve) => setTimeout(() => resolve("hang"), 500));

    actor.send(boom.create());
    expect(actor.snapshot().path[0]).toBe("__error");

    actor.recover({ state: idle, context: {} });
    expect(actor.snapshot().path[0]).toBe("idle");

    const result = await Promise.race([settledPromise, hangTimeout]);
    expect(result).not.toBe("hang");
  });
});
