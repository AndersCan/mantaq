import { expect, test, describe } from "vite-plus/test";
import { RealClock } from "../src/real-clock.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("RealClock directed mutation tests", () => {
  test("setTimeout fires after its deadline", async () => {
    const clock = new RealClock();
    let fired = false;
    const id = clock.setTimeout(5, () => {
      fired = true;
    });
    expect(typeof id).toBe("number");
    await wait(40);
    expect(fired).toBe(true);
  });

  test("clearTimeout cancels a pending timeout", async () => {
    const clock = new RealClock();
    let fired = false;
    const id = clock.setTimeout(5, () => {
      fired = true;
    });
    clock.clearTimeout(id);
    await wait(40);
    expect(fired).toBe(false);
  });

  test("setInterval fires repeatedly until clearInterval", async () => {
    const clock = new RealClock();
    let count = 0;
    const id = clock.setInterval(5, () => count++);
    await wait(25);
    clock.clearInterval(id);
    const atClear = count;
    await wait(20);
    expect(count).toBe(atClear);
    expect(atClear).toBeGreaterThan(0);
  });

  test("aborting before the deadline cancels the timeout", async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    let fired = 0;
    clock.setTimeout(10, () => fired++, { signal: controller.signal });
    controller.abort();
    await wait(40);
    expect(fired).toBe(0);
  });

  test("setTimeout without options still schedules", async () => {
    const clock = new RealClock();
    let fired = false;
    clock.setTimeout(5, () => {
      fired = true;
    });
    await wait(40);
    expect(fired).toBe(true);
  });

  test("setTimeout with options but no signal still schedules", async () => {
    const clock = new RealClock();
    let fired = false;
    clock.setTimeout(
      5,
      () => {
        fired = true;
      },
      {},
    );
    await wait(40);
    expect(fired).toBe(true);
  });

  test("aborting after a timeout fired does not clearTimeout again", async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    const calls: number[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = ((id: number) => {
      calls.push(id);
      return original(id);
    }) as typeof clearTimeout;
    try {
      let fired = false;
      const id = clock.setTimeout(
        5,
        () => {
          fired = true;
        },
        { signal: controller.signal },
      );
      const deadline = Date.now() + 100;
      while (!fired && Date.now() < deadline) {
        await wait(5);
      }
      expect(fired).toBe(true);
      controller.abort();
      expect(calls).not.toContain(id);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  test("aborting before the first tick cancels the interval", async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    let count = 0;
    clock.setInterval(10, () => count++, { signal: controller.signal });
    controller.abort();
    await wait(40);
    expect(count).toBe(0);
  });

  test("now returns increasing values", () => {
    const clock = new RealClock();
    const first = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });
});

describe("RealClock directed mutation tests 2", () => {
  test("setTimeout with an already-aborted signal returns -1", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setTimeout(5, () => {}, { signal: controller.signal })).toBe(-1);
  });
});
