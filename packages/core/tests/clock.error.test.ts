import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "../src/virtual-clock.ts";
import { RealClock } from "../src/real-clock.ts";

describe("VirtualClock error paths", () => {
  test("setTimeout with aborted signal returns -1 and does not schedule", () => {
    const clock = new VirtualClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setTimeout(50, () => {}, { signal: controller.signal })).toBe(-1);
    expect(clock.hasPending()).toBe(false);
  });

  test("setInterval with an aborted signal returns -1 and schedules nothing", () => {
    const clock = new VirtualClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setInterval(10, () => {}, { signal: controller.signal })).toBe(-1);
    expect(clock.hasPending()).toBe(false);
  });

  test("aborting a signal removes the timer", () => {
    const clock = new VirtualClock();
    const controller = new AbortController();
    let fired = 0;
    clock.setTimeout(50, () => fired++, { signal: controller.signal });
    controller.abort();
    clock.advance(100);
    expect(fired).toBe(0);
  });

  test("clearing unknown timer ids does not throw", () => {
    const clock = new VirtualClock();
    expect(() => clock.clearTimeout(999)).not.toThrow();
    expect(() => clock.clearInterval(999)).not.toThrow();
  });

  test("one interval clearing another does not throw", () => {
    const clock = new VirtualClock();
    let a = 0;
    let b = 0;
    clock.setInterval(10, () => {
      a++;
      clock.clearInterval(idB);
    });
    const idB = clock.setInterval(10, () => b++);
    expect(() => clock.advance(10)).not.toThrow();
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  test("NaN and Infinity ms throw; negative clamps to 0", () => {
    const clock = new VirtualClock();
    expect(() => clock.setTimeout(NaN, () => {})).toThrow(RangeError);
    expect(() => clock.setTimeout(Infinity, () => {})).toThrow(RangeError);
    expect(() => clock.setInterval(NaN, () => {})).toThrow(RangeError);
    expect(() => clock.advance(NaN)).toThrow(RangeError);

    let negFired = 0;
    clock.setTimeout(-1, () => negFired++);
    clock.advance(0);
    expect(negFired).toBe(1);
  });
});

describe("RealClock error paths", () => {
  test("setTimeout with aborted signal returns -1", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setTimeout(5, () => {}, { signal: controller.signal })).toBe(-1);
  });

  test("aborting before the deadline cancels the pending timeout", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    let fired = 0;
    clock.setTimeout(10, () => fired++, { signal: controller.signal });
    controller.abort();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(fired).toBe(0);
        resolve();
      }, 40),
    );
  });

  test("setInterval with an already-aborted signal returns -1", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    controller.abort();
    expect(clock.setInterval(5, () => {}, { signal: controller.signal })).toBe(-1);
  });

  test("aborting before the first tick cancels the interval", () => {
    const clock = new RealClock();
    const controller = new AbortController();
    let count = 0;
    clock.setInterval(10, () => count++, { signal: controller.signal });
    controller.abort();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(count).toBe(0);
        resolve();
      }, 40),
    );
  });
});
