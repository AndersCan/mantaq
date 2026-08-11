import { expect, test, describe, vi, afterEach, beforeEach } from "vite-plus/test";
import { VirtualClock, Context } from "@mantaq/core";
import type { withTimeout as WithTimeoutFn } from "../src/effects/timeout.ts";
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
  let withTimeout: typeof WithTimeoutFn;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const mod = await import("../src/effects/timeout.ts");
    withTimeout = mod.withTimeout;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test("warns on non-number string", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout("abc" as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[withTimeout] invalid ms value: abc"),
    );
  });

  test("warns on null", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(null as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on undefined", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(undefined as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on boolean", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(true as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on object", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout({} as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on array", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout([] as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on negative ms", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-1, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[withTimeout] invalid ms value: -1"));
  });

  test("warns on large negative ms", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-1000, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on NaN", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(NaN, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[withTimeout] invalid ms value: NaN"),
    );
  });

  test("warns on Infinity", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(Infinity, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[withTimeout] invalid ms value: Infinity"),
    );
  });

  test("warns on -Infinity", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-Infinity, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("does not warn on zero", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(0, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("does not warn on positive integer", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(100, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("does not warn on positive float", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(0.5, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("warning message contains [withTimeout] prefix", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout("bad" as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy.mock.calls[0][0]).toMatch(/^\[withTimeout\]/);
  });

  test("warning message includes the invalid value", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-42, makeInput(clock), () => ({ type: "t" }));
    expect(spy.mock.calls[0][0]).toContain("-42");
  });

  test("warning message includes the value for NaN", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(NaN, makeInput(clock), () => ({ type: "t" }));
    expect(spy.mock.calls[0][0]).toContain("NaN");
  });

  test("warns for typeof check (string)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout("hello" as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns for ms < 0 check (negative)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-0.001, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns for Number.isFinite check (Infinity)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(Number.POSITIVE_INFINITY, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns for Number.isFinite check (negative Infinity)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(Number.NEGATIVE_INFINITY, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("does not warn on 1", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(1, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("does not warn on 999999", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(999999, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("valid ms does not warn then invalid ms warns", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();

    withTimeout(50, makeInput(clock), () => ({ type: "t" }));
    expect(spy).not.toHaveBeenCalled();

    withTimeout("nope" as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warn is called exactly once per invalid call", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();

    withTimeout(-1, makeInput(clock), () => ({ type: "a" }));
    withTimeout(NaN, makeInput(clock), () => ({ type: "b" }));
    withTimeout(Infinity, makeInput(clock), () => ({ type: "c" }));

    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("warns on empty string", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout("" as unknown as number, makeInput(clock), () => ({ type: "t" }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warns on Number object wrapper", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(new Number(5) as unknown as number, makeInput(clock), () => ({
      type: "t",
    }));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("warning contains 'invalid ms value' text", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(-99, makeInput(clock), () => ({ type: "t" }));
    expect(spy.mock.calls[0][0]).toContain("invalid ms value");
  });

  test("warning contains 'Timeout may not fire' text", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = new VirtualClock();
    withTimeout(NaN, makeInput(clock), () => ({ type: "t" }));
    expect(spy.mock.calls[0][0]).toContain("Timeout may not fire");
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
});
