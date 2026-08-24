import { expect, test, describe } from "vite-plus/test";
import { RealClock } from "../src/real-clock.ts";

/**
 * Minimal AbortSignal stand-in that counts "abort" listeners so we can assert
 * the clock detaches its abort handler when a timer is cleared manually.
 */
function signalSpy() {
  let listeners = 0;
  const signal = {
    get aborted() {
      return false;
    },
    addEventListener: (type: string) => {
      if (type === "abort") listeners++;
    },
    removeEventListener: (type: string) => {
      if (type === "abort") listeners--;
    },
  } as unknown as AbortSignal;
  return { signal, count: () => listeners };
}

describe("RealClock abort-listener lifecycle", () => {
  test("clearTimeout removes the abort listener (no leak on #235)", () => {
    const clock = new RealClock();
    const { signal, count } = signalSpy();
    const id = clock.setTimeout(1000, () => {}, { signal });
    expect(count()).toBe(1);
    clock.clearTimeout(id);
    expect(count()).toBe(0);
  });

  test("clearInterval removes the abort listener (no leak on #235)", () => {
    const clock = new RealClock();
    const { signal, count } = signalSpy();
    const id = clock.setInterval(1000, () => {}, { signal });
    expect(count()).toBe(1);
    clock.clearInterval(id);
    expect(count()).toBe(0);
  });

  test("a normally-fired timeout detaches its abort listener", () => {
    const clock = new RealClock();
    const { signal, count } = signalSpy();
    clock.setTimeout(1, () => {}, { signal });
    expect(count()).toBe(1);
    return new Promise<void>((resolve) =>
      // let the (real) timer fire, then check the listener is gone
      setTimeout(() => {
        expect(count()).toBe(0);
        resolve();
      }, 30),
    );
  });
});
