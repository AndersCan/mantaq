import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "../src/virtual-clock.ts";

describe("VirtualClock directed mutation tests", () => {
  test("clearTimeout cancels a pending timer", () => {
    const clock = new VirtualClock();
    let fired = 0;
    const id = clock.setTimeout(50, () => fired++);
    clock.clearTimeout(id);
    clock.advance(100);
    expect(fired).toBe(0);
  });

  test("clearTimeout on an unknown id does not throw", () => {
    const clock = new VirtualClock();
    expect(() => clock.clearTimeout(999)).not.toThrow();
  });

  test("clearInterval stops future firings", () => {
    const clock = new VirtualClock();
    let count = 0;
    const id = clock.setInterval(20, () => count++);
    clock.advance(25);
    clock.clearInterval(id);
    clock.advance(100);
    expect(count).toBe(1);
  });

  test("clearInterval on an unknown id does not throw", () => {
    const clock = new VirtualClock();
    expect(() => clock.clearInterval(999)).not.toThrow();
  });

  test("a timer cleared by another timer at the same deadline does not fire", () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    let idB: number;
    const idA = clock.setTimeout(10, () => {
      fired.push(1);
      clock.clearTimeout(idB);
    });
    idB = clock.setTimeout(10, () => fired.push(2));
    expect(idA).toBe(1);
    clock.advance(10);
    expect(fired).toEqual([1]);
  });

  test("an interval clearing itself fires only once", () => {
    const clock = new VirtualClock();
    let count = 0;
    let id: number;
    id = clock.setInterval(10, () => {
      count++;
      clock.clearInterval(id);
    });
    clock.advance(50);
    expect(count).toBe(1);
  });

  test("setDrain runs once after advance", () => {
    const clock = new VirtualClock();
    let drained = 0;
    clock.setDrain(() => drained++);
    clock.setTimeout(10, () => {});
    clock.advance(100);
    expect(drained).toBe(1);
  });

  test("pendingTimers reports remaining ms after partial advance", () => {
    const clock = new VirtualClock();
    clock.advance(5);
    clock.setTimeout(30, () => {}, { eventName: "t" });
    clock.advance(10);
    const pending = clock.pendingTimers();
    expect(pending).toHaveLength(1);
    expect(pending[0].ms).toBe(20);
    expect(pending[0].eventName).toBe("t");
  });

  test("pendingTimers is empty after everything fires", () => {
    const clock = new VirtualClock();
    clock.setTimeout(10, () => {});
    clock.setInterval(10, () => {});
    clock.advance(10);
    expect(clock.pendingTimers()).toEqual([]);
  });

  test("hasPending is false after timers and intervals are cleared", () => {
    const clock = new VirtualClock();
    const t = clock.setTimeout(50, () => {});
    const i = clock.setInterval(50, () => {});
    clock.clearTimeout(t);
    clock.clearInterval(i);
    expect(clock.hasPending()).toBe(false);
  });

  test("timers with equal deadlines fire in scheduling order", () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    clock.setTimeout(10, () => order.push(1));
    clock.setTimeout(10, () => order.push(2));
    clock.setTimeout(10, () => order.push(3));
    clock.advance(10);
    expect(order).toEqual([1, 2, 3]);
  });

  test("intervals at the same ms fire in scheduling order each round", () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    clock.setInterval(10, () => order.push(1));
    clock.setInterval(10, () => order.push(2));
    clock.advance(25);
    expect(order).toEqual([1, 2, 1, 2]);
  });

  test("setTimeout with NaN throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.setTimeout(NaN, () => {})).toThrow(
      "[VirtualClock] invalid setTimeout ms value: NaN",
    );
  });

  test("setTimeout with Infinity throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.setTimeout(Infinity, () => {})).toThrow(RangeError);
  });

  test("setTimeout with -Infinity throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.setTimeout(-Infinity, () => {})).toThrow(RangeError);
  });

  test("setTimeout with negative ms clamps to 0 and fires on the next advance", () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(-5, () => fired++);
    clock.advance(0);
    expect(fired).toBe(1);
  });

  test("setTimeout with zero ms fires on the next advance", () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(0, () => fired++);
    clock.advance(0);
    expect(fired).toBe(1);
  });

  test("a huge finite ms schedules at its real deadline", () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(2_147_483_648, () => fired++);
    clock.advance(2_147_483_647);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  test("setInterval with NaN throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.setInterval(NaN, () => {})).toThrow(RangeError);
  });

  test("setInterval with negative ms clamps to a 1ms floor", () => {
    const clock = new VirtualClock();
    let count = 0;
    clock.setInterval(-10, () => count++);
    clock.advance(3);
    expect(count).toBe(3);
  });

  test("advance with NaN throws and leaves the clock untouched", () => {
    const clock = new VirtualClock();
    clock.advance(5);
    expect(() => clock.advance(NaN)).toThrow(RangeError);
    expect(clock.now()).toBe(5);
  });

  test("advance with Infinity throws", () => {
    const clock = new VirtualClock();
    clock.advance(5);
    expect(() => clock.advance(Infinity)).toThrow(RangeError);
    expect(clock.now()).toBe(5);
  });

  test("advance with negative ms is a no-op", () => {
    const clock = new VirtualClock();
    clock.advance(5);
    clock.advance(-3);
    expect(clock.now()).toBe(5);
  });

  test("valid ms behaves normally", () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(10, () => fired++);
    clock.advance(10);
    expect(fired).toBe(1);
  });

  test("a single timer fires exactly once across advances", () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(10, () => fired++);
    clock.advance(5);
    clock.advance(5);
    expect(fired).toBe(1);
  });

  test("an interval fires across every elapsed tick", () => {
    const clock = new VirtualClock();
    let count = 0;
    clock.setInterval(10, () => count++);
    clock.advance(25);
    expect(count).toBe(2);
  });

  test("a timer that re-arms a 0ms timer terminates instead of hanging", () => {
    const clock = new VirtualClock();
    let fires = 0;
    const id = clock.setTimeout(0, () => {
      fires++;
      clock.setTimeout(0, () => {});
    });
    expect(id).toBe(1);
    expect(() => clock.advance(1000)).not.toThrow();
    expect(fires).toBe(1);
  });

  test("a same-deadline re-arm chain is bounded by the iteration cap", () => {
    const clock = new VirtualClock();
    let fires = 0;
    const arm = () => {
      fires++;
      clock.setTimeout(0, arm);
    };
    clock.setTimeout(0, arm);
    expect(() => clock.advance(1000)).not.toThrow();
    expect(fires).toBeGreaterThan(0);
    expect(clock.now()).toBe(1000);
  });
});
