import { RealClock } from "./real-clock.ts";
import { expect, test, describe } from "vite-plus/test";

/**
 * Minimal AbortSignal stand-in that counts "abort" listeners so we can assert
 * the clock detaches its abort handler when a timer is cleared manually.
 */
function signalSpy() {
  let listeners = 0;
  const controller = new AbortController();
  const signal = new Proxy(controller.signal, {
    get(target, ...getArgs) {
      const property = getArgs[0];
      if (property === "addEventListener") {
        return (type: string) => {
          if (type === "abort") listeners++;
        };
      }
      if (property === "removeEventListener") {
        return (type: string) => {
          if (type === "abort") listeners--;
        };
      }
      return Reflect.get(target, property);
    },
  });
  return { signal, count: () => listeners };
}

describe("RealClock abort-listener lifecycle", () => {
  test("clearTimeout removes the abort listener (no leak on #235)", () => {
    const clock = RealClock();
    const { signal, count } = signalSpy();
    const timerId = clock.setTimeout(1000, { signal, cb: () => {} });
    expect(count()).toBe(1);
    clock.clearTimeout(timerId);
    expect(count()).toBe(0);
  });

  test("clearInterval removes the abort listener (no leak on #235)", () => {
    const clock = RealClock();
    const { signal, count } = signalSpy();
    const timerId = clock.setInterval(1000, { signal, cb: () => {} });
    expect(count()).toBe(1);
    clock.clearInterval(timerId);
    expect(count()).toBe(0);
  });

  test("a normally-fired timeout removes its abort listener", () => {
    const clock = RealClock();
    const { signal, count } = signalSpy();
    clock.setTimeout(1, { signal, cb: () => {} });
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
