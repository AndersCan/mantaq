import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";

describe("withTimeout", () => {
  function makeInput(clock: VirtualClock) {
    const emitted: Array<{ id: string; [key: string]: unknown }> = [];
    const ac = new AbortController();
    return {
      signal: ac.signal,
      state: { name: "idle" as const, payload: undefined },
      event: { id: "start" as const },
      context: {},
      emit: (e: { id: string; [key: string]: unknown }) => emitted.push(e),
      clock,
      emitted,
    };
  }

  test("emits event after timeout", () => {
    const clock = new VirtualClock();
    const input = makeInput(clock);
    const timeoutEvent = () => ({ id: "timeout", value: 42 });

    withTimeout(100, input as any, timeoutEvent);

    expect(input.emitted).toEqual([]);

    clock.advance(100);

    expect(input.emitted).toEqual([{ id: "timeout", value: 42 }]);
  });

  test("does not emit before timeout", () => {
    const clock = new VirtualClock();
    const input = makeInput(clock);
    const timeoutEvent = () => ({ id: "timeout" });

    withTimeout(500, input as any, timeoutEvent);

    clock.advance(499);
    expect(input.emitted).toEqual([]);
  });

  test("does not emit when aborted before timeout", () => {
    const clock = new VirtualClock();
    const input = makeInput(clock);
    const { signal: _sig, ...rest } = input;
    const ac = new AbortController();
    const timeoutEvent = () => ({ id: "timeout" });

    withTimeout(500, { ...rest, signal: ac.signal } as any, timeoutEvent);

    clock.advance(499);
    ac.abort();
    clock.advance(1);
    expect(input.emitted).toEqual([]);
  });

  test("emits exactly once", () => {
    const clock = new VirtualClock();
    const input = makeInput(clock);
    const timeoutEvent = () => ({ id: "timeout" });

    withTimeout(100, input as any, timeoutEvent);

    clock.advance(200);
    clock.advance(300);

    expect(input.emitted).toHaveLength(1);
  });
});
