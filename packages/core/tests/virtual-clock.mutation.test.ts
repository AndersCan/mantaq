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
});
