import { expect, test, describe } from "vite-plus/test";
import { VirtualClock, Context } from "@mantaq/core";
import { withTimeout } from "../src/effects/timeout.ts";

function makeInput(clock: VirtualClock) {
  const abort = new AbortController();
  return {
    signal: abort.signal,
    state: { name: "", payload: undefined },
    event: { type: "" },
    context: new Context(
      () => undefined,
      () => {},
    ),
    emit: (_e: { type: string; [key: string]: unknown }) => {},
    clock,
  };
}

describe("withTimeout mutation tests", () => {
  function collect(ms: number, advanceBy = 0) {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    withTimeout(ms, { ...makeInput(clock), emit: (e) => emitted.push(e) }, () => ({ type: "t" }));
    clock.advance(advanceBy);
    return emitted;
  }

  test("negative ms clamps to 0 and fires on the next advance", () => {
    expect(collect(-1, 0)).toEqual([{ type: "t" }]);
  });

  test("NaN ms clamps to 0 and fires on the next advance", () => {
    expect(collect(NaN, 0)).toEqual([{ type: "t" }]);
  });

  test("a numeric string is coerced like the platform", () => {
    expect(collect("5" as unknown as number, 5)).toEqual([{ type: "t" }]);
  });

  test("Infinity clamps to 1 and fires after one ms", () => {
    expect(collect(Infinity, 1)).toEqual([{ type: "t" }]);
  });

  test("valid ms fires exactly at the deadline", () => {
    expect(collect(50, 49)).toEqual([]);
    expect(collect(50, 50)).toEqual([{ type: "t" }]);
  });

  test("zero ms fires on the next advance", () => {
    expect(collect(0, 0)).toEqual([{ type: "t" }]);
  });
});

describe("withTimeout directed mutation tests", () => {
  test("aborting after scheduling suppresses the emit when the timer fires", () => {
    const clock = new VirtualClock();
    const abort = new AbortController();
    const emitted: Array<{ type: string }> = [];
    withTimeout(
      50,
      { ...makeInput(clock), signal: abort.signal, emit: (e) => emitted.push(e) },
      () => ({ type: "timeout" }),
    );
    abort.abort();
    clock.advance(200);
    expect(emitted).toEqual([]);
  });

  test("fires the emit when the signal is still active at the deadline", () => {
    const clock = new VirtualClock();
    const emitted: Array<{ type: string }> = [];
    withTimeout(50, { ...makeInput(clock), emit: (e) => emitted.push(e) }, () => ({
      type: "timeout",
    }));
    clock.advance(50);
    expect(emitted).toEqual([{ type: "timeout" }]);
  });

  test("aborting removes the scheduled timer from the clock", () => {
    const clock = new VirtualClock();
    const abort = new AbortController();
    withTimeout(50, { ...makeInput(clock), signal: abort.signal }, () => ({
      type: "timeout",
    }));
    expect(clock.hasPending()).toBe(true);
    abort.abort();
    expect(clock.hasPending()).toBe(false);
  });

  test("invalid ms is passed to the clock which clamps it", () => {
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
    withTimeout(NaN, { ...makeInput(stub as unknown as VirtualClock), clock: stub }, () => ({
      type: "timeout",
    }));
    expect(calls).toBe(1);
  });

  test("negative ms is passed to the clock which clamps it", () => {
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
    withTimeout(-5, { ...makeInput(stub as unknown as VirtualClock), clock: stub }, () => ({
      type: "timeout",
    }));
    expect(calls).toBe(1);
  });

  test("an aborted signal suppresses the emit even when the clock fires the callback", () => {
    const timers: Array<() => void> = [];
    const stub = {
      setTimeout: (_ms: number, cb: () => void) => {
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
    withTimeout(
      50,
      {
        ...makeInput(stub as unknown as VirtualClock),
        signal: abort.signal,
        emit: (e) => emitted.push(e),
        clock: stub,
      },
      () => ({ type: "timeout" }),
    );
    abort.abort();
    for (const cb of timers.splice(0)) cb();
    expect(emitted).toEqual([]);
  });
});
