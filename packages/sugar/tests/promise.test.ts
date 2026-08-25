import { expect, test, describe } from "vite-plus/test";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { withPromise } from "../src/effects/promise.ts";

describe("withPromise", () => {
  test("returns a promise that settles once the async effect completes", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    const result = withPromise(Promise.resolve(42), signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(emitted).toEqual([{ type: "ok", data: 42 }]);
  });

  test("returns a promise that settles on rejection", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    const result = withPromise(Promise.reject(new Error("fail")), signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    await result;
    expect(emitted).toEqual([{ type: "err", message: "Error: fail" }]);
  });

  test("promise effect is awaited by actor.settled()", async () => {
    const loading = state("loading")();
    const ready = state("ready")();
    const done = event("done")();
    const start = event("start")();

    const actor = new Actor({
      inputs: [start],
      internal: [done],
      states: [loading, ready],
      initial: loading,
      clock: new VirtualClock(),
      setup: (m) => {
        m.effect(loading, {
          name: "resolvePromise",
          fn: (input) => {
            return withPromise(Promise.resolve("ok"), input.signal, input.emit, {
              success: () => done.create(),
              error: (e) => done.create(),
            });
          },
        });
        m.on(loading, done, () => ({ state: ready }));
      },
    });

    actor.send(start.create());
    await actor.settled();
    expect(actor.state.name).toBe("ready");
  });

  test("emits success on resolve", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    void withPromise(Promise.resolve(42), signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    await Promise.resolve();
    expect(emitted).toEqual([{ type: "ok", data: 42 }]);
  });

  test("emits error on reject", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    void withPromise(Promise.reject(new Error("fail")), signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([{ type: "err", message: "Error: fail" }]);
  });

  test("does not emit if signal aborted before resolve", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();

    void withPromise(Promise.resolve(42), controller.signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    controller.abort();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  test("does not emit on reject if signal aborted", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();

    void withPromise(Promise.reject(new Error("fail")), controller.signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });
});
