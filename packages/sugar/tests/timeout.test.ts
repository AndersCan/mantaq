import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";

describe("withTimeout", () => {
  test("emits event after specified ms", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ id: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        emit: (e) => emitted.push(e),
        clock,
      },
      () => ({ id: "timeout" }),
    );

    clock.advance(99);
    expect(emitted).toEqual([]);

    clock.advance(1);
    expect(emitted).toEqual([{ id: "timeout" }]);
  });

  test("does not emit if timer aborted before fire", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ id: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      100,
      {
        signal: abort.signal,
        emit: (e) => emitted.push(e),
        clock,
      },
      () => ({ id: "timeout" }),
    );

    abort.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("does not emit if signal already aborted", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ id: string; [key: string]: unknown }> = [];
    const abort = new AbortController();
    abort.abort();

    withTimeout(
      100,
      {
        signal: abort.signal,
        emit: (e) => emitted.push(e),
        clock,
      },
      () => ({ id: "timeout" }),
    );

    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("emits correct event payload", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ id: string; [key: string]: unknown }> = [];
    const abort = new AbortController();

    withTimeout(
      50,
      {
        signal: abort.signal,
        emit: (e) => emitted.push(e),
        clock,
      },
      () => ({ id: "customTimeout", reason: "exceeded" }),
    );

    clock.advance(50);
    expect(emitted).toEqual([{ id: "customTimeout", reason: "exceeded" }]);
  });
});
