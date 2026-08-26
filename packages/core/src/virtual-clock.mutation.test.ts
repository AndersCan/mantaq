import { VirtualClock } from "./virtual-clock.ts";
import { expect, test, describe } from "vite-plus/test";

describe("VirtualClock directed mutation tests", () => {
  test("clearTimeout removes a pending timer", () => {
    const clock = VirtualClock();
    let fired = 0;
    const timerId = clock.setTimeout(50, { cb: () => fired++ });
    clock.clearTimeout(timerId);
    clock.advance(100);
    expect(fired).toBe(0);
  });

  test("clearTimeout on an unknown timerId does not throw", () => {
    const clock = VirtualClock();
    expect(() => clock.clearTimeout(999)).not.toThrow();
  });

  test("clearInterval removes future firings", () => {
    const clock = VirtualClock();
    let count = 0;
    const timerId = clock.setInterval(20, { cb: () => count++ });
    clock.advance(25);
    clock.clearInterval(timerId);
    clock.advance(100);
    expect(count).toBe(1);
  });

  test("clearInterval on an unknown timerId does not throw", () => {
    const clock = VirtualClock();
    expect(() => clock.clearInterval(999)).not.toThrow();
  });

  test("a timer cleared by another timer at the same deadline skips its callback", () => {
    const clock = VirtualClock();
    const fired: number[] = [];
    let secondTimerId: number;
    const firstTimerId = clock.setTimeout(10, {
      cb: () => {
        fired.push(1);
        clock.clearTimeout(secondTimerId);
      },
    });
    secondTimerId = clock.setTimeout(10, { cb: () => fired.push(2) });
    expect(firstTimerId).toBe(1);
    clock.advance(10);
    expect(fired).toEqual([1]);
  });

  test("an interval that clears itself calls its callback only once", () => {
    const clock = VirtualClock();
    let count = 0;
    let intervalId: number;
    intervalId = clock.setInterval(10, {
      cb: () => {
        count++;
        clock.clearInterval(intervalId);
      },
    });
    clock.advance(50);
    expect(count).toBe(1);
  });

  test("setDrain calls the drain once after advance", () => {
    const clock = VirtualClock();
    let drained = 0;
    clock.setDrain(() => drained++);
    clock.setTimeout(10, { cb: () => {} });
    clock.advance(100);
    expect(drained).toBe(1);
  });

  test("setDrain calls every registered drain, not just the last", () => {
    const clock = VirtualClock();
    let a = 0;
    let b = 0;
    clock.setDrain(() => a++);
    clock.setDrain(() => b++);
    clock.setTimeout(10, { cb: () => {} });
    clock.advance(100);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test("pendingTimers returns the remaining ms after partial advance", () => {
    const clock = VirtualClock();
    clock.advance(5);
    clock.setTimeout(30, { eventName: "t", cb: () => {} });
    clock.advance(10);
    const pending = clock.pendingTimers();
    expect(pending).toHaveLength(1);
    expect({ ms: pending[0]?.ms, eventName: pending[0]?.eventName }).toEqual({
      ms: 20,
      eventName: "t",
    });
  });

  test("pendingTimers returns an empty list once everything has fired", () => {
    const clock = VirtualClock();
    clock.setTimeout(10, { cb: () => {} });
    clock.setInterval(10, { cb: () => {} });
    clock.advance(10);
    expect(clock.pendingTimers()).toEqual([]);
  });

  test("hasPending returns false after timers and intervals are cleared", () => {
    const clock = VirtualClock();
    const timeoutId = clock.setTimeout(50, { cb: () => {} });
    const intervalId = clock.setInterval(50, { cb: () => {} });
    clock.clearTimeout(timeoutId);
    clock.clearInterval(intervalId);
    expect(clock.hasPending()).toBe(false);
  });

  test("timers with equal deadlines call their callbacks in scheduling order", () => {
    const clock = VirtualClock();
    const order: number[] = [];
    clock.setTimeout(10, { cb: () => order.push(1) });
    clock.setTimeout(10, { cb: () => order.push(2) });
    clock.setTimeout(10, { cb: () => order.push(3) });
    clock.advance(10);
    expect(order).toEqual([1, 2, 3]);
  });

  test("intervals at the same ms call their callbacks in scheduling order each round", () => {
    const clock = VirtualClock();
    const order: number[] = [];
    clock.setInterval(10, { cb: () => order.push(1) });
    clock.setInterval(10, { cb: () => order.push(2) });
    clock.advance(25);
    expect(order).toEqual([1, 2, 1, 2]);
  });

  test("setTimeout with NaN throws", () => {
    const clock = VirtualClock();
    expect(() => clock.setTimeout(NaN, { cb: () => {} })).toThrow(
      "[VirtualClock] invalid setTimeout ms value: NaN",
    );
  });

  test("setTimeout with Infinity throws", () => {
    const clock = VirtualClock();
    expect(() => clock.setTimeout(Infinity, { cb: () => {} })).toThrow(RangeError);
  });

  test("setTimeout with -Infinity throws", () => {
    const clock = VirtualClock();
    expect(() => clock.setTimeout(-Infinity, { cb: () => {} })).toThrow(RangeError);
  });

  test("setTimeout normalizes negative ms to 0 and fires on the next advance", () => {
    const clock = VirtualClock();
    let fired = 0;
    clock.setTimeout(-5, { cb: () => fired++ });
    clock.advance(0);
    expect(fired).toBe(1);
  });

  test("setTimeout with zero ms calls its callback on the next advance", () => {
    const clock = VirtualClock();
    let fired = 0;
    clock.setTimeout(0, { cb: () => fired++ });
    clock.advance(0);
    expect(fired).toBe(1);
  });

  test("setTimeout keeps a huge finite ms at its real deadline", () => {
    const clock = VirtualClock();
    let fired = 0;
    clock.setTimeout(2_147_483_648, { cb: () => fired++ });
    clock.advance(2_147_483_647);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  test("setInterval with NaN throws", () => {
    const clock = VirtualClock();
    expect(() => clock.setInterval(NaN, { cb: () => {} })).toThrow(RangeError);
  });

  test("setInterval normalizes negative ms to a 1ms floor", () => {
    const clock = VirtualClock();
    let count = 0;
    clock.setInterval(-10, { cb: () => count++ });
    clock.advance(3);
    expect(count).toBe(3);
  });

  test("advance with NaN throws and leaves the clock untouched", () => {
    const clock = VirtualClock();
    clock.advance(5);
    expect(() => clock.advance(NaN)).toThrow(RangeError);
    expect(clock.now()).toBe(5);
  });

  test("advance with Infinity throws", () => {
    const clock = VirtualClock();
    clock.advance(5);
    expect(() => clock.advance(Infinity)).toThrow(RangeError);
    expect(clock.now()).toBe(5);
  });

  test("advance treats negative ms as a no-op", () => {
    const clock = VirtualClock();
    clock.advance(5);
    clock.advance(-3);
    expect(clock.now()).toBe(5);
  });

  test("advance keeps valid ms unchanged", () => {
    const clock = VirtualClock();
    let fired = 0;
    clock.setTimeout(10, { cb: () => fired++ });
    clock.advance(10);
    expect(fired).toBe(1);
  });

  test("a single timer calls its callback exactly once across advances", () => {
    const clock = VirtualClock();
    let fired = 0;
    clock.setTimeout(10, { cb: () => fired++ });
    clock.advance(5);
    clock.advance(5);
    expect(fired).toBe(1);
  });

  test("an interval calls its callback on every elapsed tick", () => {
    const clock = VirtualClock();
    let count = 0;
    clock.setInterval(10, { cb: () => count++ });
    clock.advance(25);
    expect(count).toBe(2);
  });

  test("a timer that re-arms a 0ms timer keeps the advance loop bounded instead of hanging", () => {
    const clock = VirtualClock();
    let fires = 0;
    const timerId = clock.setTimeout(0, {
      cb: () => {
        fires++;
        clock.setTimeout(0, { cb: () => {} });
      },
    });
    expect(timerId).toBe(1);
    expect(() => clock.advance(1000)).not.toThrow();
    expect(fires).toBe(1);
  });

  test("the iteration cap keeps a same-deadline re-arm chain bounded", () => {
    const clock = VirtualClock();
    let fires = 0;
    function arm(): void {
      fires++;
      clock.setTimeout(0, { cb: arm });
    }
    clock.setTimeout(0, { cb: arm });
    expect(() => clock.advance(1000)).not.toThrow();
    expect(fires).toBeGreaterThan(0);
    expect(clock.now()).toBe(1000);
  });

  test("a long advance with a short interval calls the callback every period, not just up to the cap", () => {
    const clock = VirtualClock();
    let fires = 0;
    clock.setInterval(1, {
      cb: () => {
        fires++;
      },
    });
    clock.advance(2_000_000);
    expect(fires).toBe(2_000_000);
    expect(clock.now()).toBe(2_000_000);
  });
});
