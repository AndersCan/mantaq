import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";

describe("withTimeout", () => {
  test("emits event after delay", () => {
    const clock = new VirtualClock();
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);

    withTimeout(
      100,
      {
        signal: new AbortController().signal,
        state: { name: "loading", payload: undefined },
        event: { id: "load" },
        context: {},
        emit,
        clock,
      } as any,
      () => ({ id: "timeout" }),
    );

    clock.advance(99);
    expect(emitted).toEqual([]);

    clock.advance(1);
    expect(emitted).toEqual([{ id: "timeout" }]);
  });

  test("does not emit if signal already aborted", () => {
    const clock = new VirtualClock();
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();
    controller.abort();

    withTimeout(
      100,
      {
        signal: controller.signal,
        state: { name: "loading", payload: undefined },
        event: { id: "load" },
        context: {},
        emit,
        clock,
      } as any,
      () => ({ id: "timeout" }),
    );

    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("does not emit after advance if aborted later", () => {
    const clock = new VirtualClock();
    const emitted: unknown[] = [];
    const emit = (e: unknown) => emitted.push(e);
    const controller = new AbortController();

    withTimeout(
      100,
      {
        signal: controller.signal,
        state: { name: "loading", payload: undefined },
        event: { id: "load" },
        context: {},
        emit,
        clock,
      } as any,
      () => ({ id: "timeout" }),
    );

    clock.advance(50);
    controller.abort();
    clock.advance(100);
    expect(emitted).toEqual([]);
  });
});
