import { expect, test, describe } from "vite-plus/test";
import { withPromise } from "../src/effects/promise.ts";

describe("withPromise", () => {
  test("emits success on resolve", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    withPromise(Promise.resolve(42), signal, emit, {
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

    withPromise(Promise.reject(new Error("fail")), signal, emit, {
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

    withPromise(Promise.resolve(42), controller.signal, emit, {
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

    withPromise(Promise.reject(new Error("fail")), controller.signal, emit, {
      success: (data) => ({ type: "ok", data }),
      error: (err) => ({ type: "err", message: String(err) }),
    });

    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });
});
