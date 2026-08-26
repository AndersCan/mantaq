import { withPromise } from "./promise.ts";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

describe("withPromise", () => {
  test("returns a promise that settles once the async effect completes", async () => {
    const emitted: unknown[] = [];
    const signal = new AbortController().signal;
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    const result = withPromise({
      promise: Promise.resolve(42),
      signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(emitted).toEqual([{ type: "ok", data: 42 }]);
  });

  test("returns a promise that settles on rejection", async () => {
    const emitted: unknown[] = [];
    const signal = new AbortController().signal;
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    const result = withPromise({
      promise: Promise.reject(new Error("fail")),
      signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    await result;
    expect(emitted).toEqual([{ type: "err", message: "Error: fail" }]);
  });

  test("resolves into the target state once the promise effect settles", async () => {
    const loading = state("loading")();
    const ready = state("ready")();
    const done = event("done")();
    const start = event("start")();

    const actor = Actor({
      inputs: [start],
      internal: [done],
      states: [loading, ready],
      initial: loading,
      clock: VirtualClock(),
      setup: (m) => {
        m.effect(loading, {
          name: "resolvePromise",
          fn: (input) => {
            return withPromise({
              promise: Promise.resolve("ok"),
              signal: input.signal,
              emit: input.emit,
              events: {
                success: () => done.create(),
                error: (_e) => done.create(),
              },
            });
          },
        });
        m.on(loading, { eventRef: done, handler: () => ({ state: ready }) });
      },
    });

    actor.send(start.create());
    await actor.settled();
    expect(actor.state.name).toBe("ready");
  });

  test("emits success on resolve", async () => {
    const emitted: unknown[] = [];
    const signal = new AbortController().signal;
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    void withPromise({
      promise: Promise.resolve(42),
      signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    await Promise.resolve();
    expect(emitted).toEqual([{ type: "ok", data: 42 }]);
  });

  test("emits error on reject", async () => {
    const emitted: unknown[] = [];
    const signal = new AbortController().signal;
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    void withPromise({
      promise: Promise.reject(new Error("fail")),
      signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([{ type: "err", message: "Error: fail" }]);
  });

  test("does not emit if the signal aborted before resolve", async () => {
    const emitted: unknown[] = [];
    const controller = new AbortController();
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    void withPromise({
      promise: Promise.resolve(42),
      signal: controller.signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    controller.abort();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  test("does not emit on reject if the signal aborted", async () => {
    const emitted: unknown[] = [];
    const controller = new AbortController();
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    void withPromise({
      promise: Promise.reject(new Error("fail")),
      signal: controller.signal,
      emit,
      events: {
        success: (data) => ({ type: "ok", data }),
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  test("does not swallow a success-path throw as an error event (#268)", async () => {
    const emitted: unknown[] = [];
    const signal = new AbortController().signal;
    function emit(emittedEvent: unknown): void {
      emitted.push(emittedEvent);
    }

    // The success callback throws — a real failure in the success path. With
    // the original `.then(...).catch(...)` chain this throw was caught by the
    // `.catch` and re-emitted as a spurious `error` event. The two-argument
    // `then` leaves the success callback's throw uncaught (as it should be).
    const result = withPromise({
      promise: Promise.resolve(1),
      signal,
      emit,
      events: {
        success: () => {
          throw new Error("boom in success");
        },
        error: (err) => ({ type: "err", message: String(err) }),
      },
    });

    await expect(result).rejects.toThrow("boom in success");
    expect(emitted).toEqual([]);
  });
});
