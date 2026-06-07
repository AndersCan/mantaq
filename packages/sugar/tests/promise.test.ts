import { expect, test, describe } from "vite-plus/test";
import { onSuccess, onError, withPromise } from "../src/effects/promise.ts";

describe("onSuccess", () => {
  test("emits event with result", () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const event = (data: string) => ({ id: "ok", data });

    onSuccess("hello", emit, event);

    expect(emitted).toEqual([{ id: "ok", data: "hello" }]);
  });
});

describe("onError", () => {
  test("emits event with error", () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const event = (err: unknown) => ({ id: "err", message: String(err) });

    onError(new Error("boom"), emit, event);

    expect(emitted).toEqual([{ id: "err", message: "Error: boom" }]);
  });
});

describe("withPromise", () => {
  test("emits success on resolve", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    withPromise(Promise.resolve(42), signal, emit, {
      success: (data) => ({ id: "ok", data }),
      error: (err) => ({ id: "err", message: String(err) }),
    });

    await Promise.resolve();
    expect(emitted).toEqual([{ id: "ok", data: 42 }]);
  });

  test("emits error on reject", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const signal = new AbortController().signal;

    withPromise(Promise.reject(new Error("fail")), signal, emit, {
      success: (data) => ({ id: "ok", data }),
      error: (err) => ({ id: "err", message: String(err) }),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([{ id: "err", message: "Error: fail" }]);
  });

  test("does not emit if signal aborted before resolve", async () => {
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();

    withPromise(Promise.resolve(42), controller.signal, emit, {
      success: (data) => ({ id: "ok", data }),
      error: (err) => ({ id: "err", message: String(err) }),
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
      success: (data) => ({ id: "ok", data }),
      error: (err) => ({ id: "err", message: String(err) }),
    });

    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });
});
