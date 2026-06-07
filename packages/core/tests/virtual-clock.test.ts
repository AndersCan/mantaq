import { expect, test, describe } from "vite-plus/test";
import { VirtualClock } from "../src/actor.ts";

describe("VirtualClock", () => {
  test("now() starts at 0", () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
  });

  test("advance() increments now()", () => {
    const clock = new VirtualClock();
    clock.advance(100);
    expect(clock.now()).toBe(100);
  });

  test("advance() accumulates across calls", () => {
    const clock = new VirtualClock();
    clock.advance(100);
    clock.advance(250);
    expect(clock.now()).toBe(350);
  });

  test("timer fires at exact deadline", () => {
    const clock = new VirtualClock();
    let fired = false;
    clock.setTimeout(500, () => {
      fired = true;
    });

    clock.advance(499);
    expect(fired).toBe(false);

    clock.advance(1);
    expect(fired).toBe(true);
  });

  test("timer fires when advance exceeds deadline", () => {
    const clock = new VirtualClock();
    let fired = false;
    clock.setTimeout(500, () => {
      fired = true;
    });

    clock.advance(1000);
    expect(fired).toBe(true);
  });

  test("multiple timers fire in order", () => {
    const clock = new VirtualClock();
    const order: number[] = [];
    clock.setTimeout(300, () => order.push(300));
    clock.setTimeout(100, () => order.push(100));
    clock.setTimeout(200, () => order.push(200));

    clock.advance(500);
    expect(order).toEqual([100, 200, 300]);
  });

  test("multiple timers — partial advance fires only due", () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(100, () => fired.push(100));
    clock.setTimeout(300, () => fired.push(300));
    clock.setTimeout(500, () => fired.push(500));

    clock.advance(200);
    expect(fired).toEqual([100]);
    expect(clock.hasPending()).toBe(true);

    clock.advance(200);
    expect(fired).toEqual([100, 300]);
    expect(clock.hasPending()).toBe(true);

    clock.advance(200);
    expect(fired).toEqual([100, 300, 500]);
    expect(clock.hasPending()).toBe(false);
  });

  test("clearTimeout prevents firing", () => {
    const clock = new VirtualClock();
    let fired = false;
    const id = clock.setTimeout(500, () => {
      fired = true;
    });

    clock.clearTimeout(id);
    clock.advance(1000);
    expect(fired).toBe(false);
  });

  test("clearTimeout on non-existent id is no-op", () => {
    const clock = new VirtualClock();
    clock.clearTimeout(999);
    clock.advance(1000);
  });

  test("hasPending() reflects timer count", () => {
    const clock = new VirtualClock();
    expect(clock.hasPending()).toBe(false);

    const id1 = clock.setTimeout(100, () => {});
    expect(clock.hasPending()).toBe(true);

    const id2 = clock.setTimeout(200, () => {});
    expect(clock.hasPending()).toBe(true);

    clock.clearTimeout(id1);
    expect(clock.hasPending()).toBe(true);

    clock.clearTimeout(id2);
    expect(clock.hasPending()).toBe(false);
  });

  test("hasPending() false after all timers fire", () => {
    const clock = new VirtualClock();
    clock.setTimeout(100, () => {});
    clock.setTimeout(200, () => {});

    expect(clock.hasPending()).toBe(true);
    clock.advance(300);
    expect(clock.hasPending()).toBe(false);
  });

  test("timer callback receives no arguments", () => {
    const clock = new VirtualClock();
    let args: any[] = [];
    clock.setTimeout(100, (...a: any[]) => {
      args = a;
    });

    clock.advance(100);
    expect(args).toEqual([]);
  });

  test("fired timer is removed — no double fire", () => {
    const clock = new VirtualClock();
    let count = 0;
    clock.setTimeout(100, () => {
      count++;
    });

    clock.advance(100);
    clock.advance(100);
    clock.advance(100);
    expect(count).toBe(1);
  });

  test("new timer after advance uses updated now()", () => {
    const clock = new VirtualClock();
    clock.advance(1000);

    let fired = false;
    clock.setTimeout(500, () => {
      fired = true;
    });

    clock.advance(499);
    expect(fired).toBe(false);

    clock.advance(1);
    expect(fired).toBe(true);
    expect(clock.now()).toBe(1500);
  });

  test("interval fires at scheduled times", () => {
    const clock = new VirtualClock();
    const times: number[] = [];
    clock.setInterval(100, () => {
      times.push(clock.now());
    });

    clock.advance(250);
    expect(times).toEqual([100, 200]);
  });

  test("timer clears interval at same timestamp — interval does not fire", () => {
    const clock = new VirtualClock();
    const timerFired: number[] = [];
    const intervalFired: number[] = [];

    const intervalId = clock.setInterval(200, () => {
      intervalFired.push(clock.now());
    });

    clock.setTimeout(200, () => {
      timerFired.push(clock.now());
      clock.clearInterval(intervalId);
    });

    clock.advance(500);
    expect(timerFired).toEqual([200]);
    expect(intervalFired).toEqual([]);
    expect(clock.hasPending()).toBe(false);
  });

  test("timer clears interval at later timestamp — only earlier interval fires", () => {
    const clock = new VirtualClock();
    const timerFired: number[] = [];
    const intervalFired: number[] = [];

    const intervalId = clock.setInterval(100, () => {
      intervalFired.push(clock.now());
    });

    clock.setTimeout(350, () => {
      timerFired.push(clock.now());
      clock.clearInterval(intervalId);
    });

    clock.advance(500);
    expect(timerFired).toEqual([350]);
    expect(intervalFired).toEqual([100, 200, 300]);
    expect(clock.hasPending()).toBe(false);
  });

  test("setTimeout with already-aborted signal returns -1", () => {
    const clock = new VirtualClock();
    const aborted = new AbortController();
    aborted.abort();
    const id = clock.setTimeout(100, () => {}, { signal: aborted.signal });
    expect(id).toBe(-1);
  });

  test("setInterval with already-aborted signal returns -1", () => {
    const clock = new VirtualClock();
    const aborted = new AbortController();
    aborted.abort();
    const id = clock.setInterval(100, () => {}, { signal: aborted.signal });
    expect(id).toBe(-1);
  });

  test("clearInterval on non-existent id is no-op", () => {
    const clock = new VirtualClock();
    clock.clearInterval(999);
    clock.advance(1000);
  });

  test("advance() throws on infinite timer loop", () => {
    const clock = new VirtualClock();
    const rearm = () => {
      clock.setTimeout(0, rearm);
    };
    clock.setTimeout(0, rearm);
    expect(() => clock.advance(1000)).toThrow("exceeded maximum iterations");
  });
});
