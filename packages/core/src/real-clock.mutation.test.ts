import { RealClock } from "./real-clock.ts";
import { expect, test, describe } from "vite-plus/test";

function wait(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

describe("RealClock directed mutation tests", () => {
  test("setTimeout calls back after its deadline", async () => {
    const clock = RealClock();
    let fired = false;
    const timerId = clock.setTimeout(5, {
      cb: () => {
        fired = true;
      },
    });
    expect(typeof timerId).toBe("number");
    await wait(40);
    expect(fired).toBe(true);
  });

  test("clearTimeout removes a pending timeout", async () => {
    const clock = RealClock();
    let fired = false;
    const timerId = clock.setTimeout(5, {
      cb: () => {
        fired = true;
      },
    });
    clock.clearTimeout(timerId);
    await wait(40);
    expect(fired).toBe(false);
  });

  test("setInterval calls back repeatedly until clearInterval", async () => {
    const clock = RealClock();
    let count = 0;
    const timerId = clock.setInterval(5, { cb: () => count++ });
    await wait(25);
    clock.clearInterval(timerId);
    const atClear = count;
    await wait(20);
    expect(count).toBe(atClear);
    expect(atClear).toBeGreaterThan(0);
  });

  test("aborting before the deadline removes the timeout", async () => {
    const clock = RealClock();
    const controller = new AbortController();
    let fired = 0;
    clock.setTimeout(10, { signal: controller.signal, cb: () => fired++ });
    controller.abort();
    await wait(40);
    expect(fired).toBe(0);
  });

  test("aborting before the first tick removes the interval", async () => {
    const clock = RealClock();
    const controller = new AbortController();
    let count = 0;
    clock.setInterval(10, { signal: controller.signal, cb: () => count++ });
    controller.abort();
    await wait(40);
    expect(count).toBe(0);
  });

  test("now returns increasing values", () => {
    const clock = RealClock();
    const first = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });
});

describe("RealClock directed mutation tests 2", () => {
  test("setTimeout with an already-aborted signal returns -1", () => {
    const clock = RealClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setTimeout(5, { signal: controller.signal, cb: () => {} })).toBe(-1);
  });

  test("setInterval with an already-aborted signal returns -1 and never fires", () => {
    const clock = RealClock();
    const controller = new AbortController();
    controller.abort();
    let fired = 0;
    expect(clock.setInterval(5, { signal: controller.signal, cb: () => fired++ })).toBe(-1);
    // The aborted guard must prevent any interval from being scheduled.
    expect(fired).toBe(0);
  });
});
