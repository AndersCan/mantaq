import { withTimeout } from "./timeout.ts";
import { VirtualClock, Context } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function makeInput(clock: Clock) {
  const abort = new AbortController();
  return {
    signal: abort.signal,
    state: { name: "", payload: undefined },
    event: { type: "" },
    context: Context({ get: () => undefined, set: () => {} }),
    emit: (_emitted: { type: string; [key: string]: unknown }) => {},
    clock,
  };
}

describe("withTimeout mutation tests", () => {
  function collect(durationMs: number, { advanceBy = 0 }: { advanceBy?: number } = {}) {
    const clock = VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    withTimeout(durationMs, {
      input: { ...makeInput(clock), emit: (event) => emitted.push(event) },
      event: () => ({ type: "t" }),
    });
    clock.advance(advanceBy);
    return emitted;
  }

  test("emits on the next advance when negative ms clamps to 0", () => {
    expect(collect(-1)).toEqual([{ type: "t" }]);
  });

  test("throws RangeError for NaN ms (the clock rejects it)", () => {
    expect(() =>
      withTimeout(NaN, { input: makeInput(VirtualClock()), event: () => ({ type: "t" }) }),
    ).toThrow(RangeError);
  });

  test("throws RangeError for Infinity ms (the clock rejects it)", () => {
    expect(() =>
      withTimeout(Infinity, { input: makeInput(VirtualClock()), event: () => ({ type: "t" }) }),
    ).toThrow(RangeError);
  });

  test("emits exactly at the deadline for valid ms", () => {
    expect(collect(50, { advanceBy: 49 })).toEqual([]);
    expect(collect(50, { advanceBy: 50 })).toEqual([{ type: "t" }]);
  });

  test("emits on the next advance for zero ms", () => {
    expect(collect(0)).toEqual([{ type: "t" }]);
  });
});

describe("withTimeout directed mutation tests", () => {
  test("skips the emit when the signal aborted after scheduling", () => {
    const clock = VirtualClock();
    const abort = new AbortController();
    const emitted: Array<{ type: string }> = [];
    withTimeout(50, {
      input: {
        ...makeInput(clock),
        signal: abort.signal,
        emit: (event) => emitted.push(event),
      },
      event: () => ({ type: "timeout" }),
    });
    abort.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("emits when the signal is still active at the deadline", () => {
    const clock = VirtualClock();
    const emitted: Array<{ type: string }> = [];
    withTimeout(50, {
      input: { ...makeInput(clock), emit: (event) => emitted.push(event) },
      event: () => ({ type: "timeout" }),
    });
    clock.advance(50);
    expect(emitted).toEqual([{ type: "timeout" }]);
  });

  test("removes the scheduled timer from the clock on abort", () => {
    const clock = VirtualClock();
    const abort = new AbortController();
    withTimeout(50, {
      input: { ...makeInput(clock), signal: abort.signal },
      event: () => ({ type: "timeout" }),
    });
    expect(clock.hasPending()).toBe(true);
    abort.abort();
    expect(clock.hasPending()).toBe(false);
  });

  test("sets invalid NaN ms on the clock which clamps it", () => {
    let calls = 0;
    const stub = {
      setTimeout: () => {
        calls++;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      now: () => 0,
    };
    withTimeout(NaN, { input: makeInput(stub), event: () => ({ type: "timeout" }) });
    expect(calls).toBe(1);
  });

  test("sets invalid negative ms on the clock which clamps it", () => {
    let calls = 0;
    const stub = {
      setTimeout: () => {
        calls++;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      now: () => 0,
    };
    withTimeout(-5, { input: makeInput(stub), event: () => ({ type: "timeout" }) });
    expect(calls).toBe(1);
  });

  test("keeps the emit suppressed from an aborted signal even when the clock fires the callback", () => {
    const timers: Array<() => void> = [];
    const stub = {
      setTimeout: (ms: number, { cb }: { cb: () => void }) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      now: () => 0,
    };
    const abort = new AbortController();
    const emitted: unknown[] = [];
    withTimeout(50, {
      input: {
        ...makeInput(stub),
        signal: abort.signal,
        emit: (event) => emitted.push(event),
        clock: stub,
      },
      event: () => ({ type: "timeout" }),
    });
    abort.abort();
    for (const callback of timers.splice(0)) callback();
    expect(emitted).toEqual([]);
  });
});
