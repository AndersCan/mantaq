import { test, describe } from "vite-plus/test";
import { fc, anyDuration, anySmallDuration, runProperty } from "@mantaq/pbt";
import { VirtualClock } from "../src/virtual-clock.ts";

interface TimerJob {
  id: number;
  ms: number;
}

interface IntervalJob {
  id: number;
  ms: number;
  next: number;
}

function referenceRun(timers: TimerJob[], intervals: IntervalJob[], target: number): string[] {
  const events: string[] = [];
  const remaining = timers.map((t) => ({ ...t, fired: false }));
  const active = intervals.map((i) => ({ ...i }));
  while (true) {
    let earliest: number | null = null;
    for (const t of remaining) {
      if (!t.fired && t.ms <= target && (earliest === null || t.ms <= earliest)) earliest = t.ms;
    }
    for (const iv of active) {
      if (iv.next <= target && (earliest === null || iv.next <= earliest)) earliest = iv.next;
    }
    if (earliest === null) break;
    for (const t of remaining) {
      if (!t.fired && t.ms === earliest) {
        t.fired = true;
        events.push(`t${t.id}`);
      }
    }
    for (const iv of active) {
      if (iv.next === earliest) {
        events.push(`i${iv.id}`);
        iv.next = earliest + iv.ms;
      }
    }
  }
  return events;
}

function referencePending(timers: TimerJob[], intervals: IntervalJob[], target: number): boolean {
  return timers.some((t) => t.ms > target) || intervals.length > 0;
}

describe("VirtualClock property tests", () => {
  test("timers and intervals fire exactly per deadline for any schedule", () => {
    runProperty(
      fc.tuple(
        fc.array(anyDuration, { maxLength: 6 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 4 }),
        anyDuration,
      ),
      ([timerMss, intervalMss, target]) => {
        const clock = new VirtualClock();
        const events: string[] = [];
        const timers: TimerJob[] = [];
        for (const ms of timerMss) {
          const id = clock.setTimeout(ms, () => events.push(`t${id}`));
          timers.push({ id, ms });
        }
        const intervals: IntervalJob[] = [];
        for (const ms of intervalMss) {
          const id = clock.setInterval(ms, () => events.push(`i${id}`));
          intervals.push({ id, ms, next: ms });
        }

        clock.advance(target);

        const expected = referenceRun(timers, intervals, target);
        if (events.join(",") !== expected.join(",")) return false;

        const expectedPending = referencePending(timers, intervals, target);
        if (clock.hasPending() !== expectedPending) return false;

        if (clock.now() !== target) return false;

        return true;
      },
    );
  });

  test("aborted timers never fire and cleared timers never fire", () => {
    runProperty(
      fc.tuple(
        fc.array(anyDuration, { maxLength: 6 }),
        fc.array(fc.boolean(), { maxLength: 6 }),
        anyDuration,
      ),
      ([mss, aborted, target]) => {
        const clock = new VirtualClock();
        const fired = new Set<number>();
        const controllers = new Map<number, AbortController>();
        for (let i = 0; i < mss.length; i++) {
          const controller = new AbortController();
          const id = clock.setTimeout(
            mss[i],
            () => {
              fired.add(id);
            },
            { signal: controller.signal },
          );
          controllers.set(id, controller);
          if (aborted[i] === true) controller.abort();
        }

        clock.advance(target);

        for (const id of controllers.keys()) {
          if (controllers.get(id)?.signal.aborted) {
            if (fired.has(id)) return false;
          } else if (mss[id - 1] <= target) {
            if (!fired.has(id)) return false;
          }
        }
        return true;
      },
    );
  });
});

describe("VirtualClock firing-order property tests", () => {
  test("timers fire in deadline order regardless of registration order", () => {
    runProperty(
      fc.tuple(fc.array(anySmallDuration, { minLength: 2, maxLength: 12 }), anyDuration),
      ([deadlines, target]) => {
        const clock = new VirtualClock();
        const fired: Array<{ ms: number }> = [];
        for (const ms of deadlines) {
          clock.setTimeout(ms, () => fired.push({ ms }));
        }

        clock.advance(target);

        const expected = deadlines
          .map((ms, index) => ({ ms, index }))
          .filter(({ ms }) => ms <= target)
          .sort((a, b) => a.ms - b.ms || a.index - b.index);
        if (fired.length !== expected.length) return false;
        for (let i = 0; i < expected.length; i++) {
          if (fired[i].ms !== expected[i].ms) return false;
        }
        return true;
      },
    );
  });

  test("timers registered in reverse deadline order still fire in time order", () => {
    runProperty(
      fc.tuple(fc.array(anySmallDuration, { minLength: 2, maxLength: 12 }), anyDuration),
      ([mss, target]) => {
        const deadlines = [...mss].sort((a, b) => b - a);
        const clock = new VirtualClock();
        const fired: Array<{ ms: number }> = [];
        for (const ms of deadlines) {
          clock.setTimeout(ms, () => fired.push({ ms }));
        }

        clock.advance(target);

        const expected = deadlines
          .map((ms, index) => ({ ms, index }))
          .filter(({ ms }) => ms <= target)
          .sort((a, b) => a.ms - b.ms || a.index - b.index);
        if (fired.length !== expected.length) return false;
        for (let i = 0; i < expected.length; i++) {
          if (fired[i].ms !== expected[i].ms) return false;
        }
        return true;
      },
    );
  });
});

describe("VirtualClock boundary property tests", () => {
  test("timers scheduled at or around the advance target fire exactly", () => {
    runProperty(
      fc.tuple(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(fc.integer({ min: -2, max: 2 }), { maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 3 }),
      ),
      ([target, offsets, intervalMss]) => {
        const clock = new VirtualClock();
        const events: string[] = [];
        const timers: TimerJob[] = [];
        for (const offset of offsets) {
          const ms = Math.max(0, target + offset);
          const id = clock.setTimeout(ms, () => events.push(`t${id}`));
          timers.push({ id, ms });
        }
        const intervals: IntervalJob[] = [];
        for (const ms of intervalMss) {
          const id = clock.setInterval(ms, () => events.push(`i${id}`));
          intervals.push({ id, ms, next: ms });
        }

        clock.advance(target);

        const expected = referenceRun(timers, intervals, target);
        return events.join(",") === expected.join(",");
      },
    );
  });
});

describe("VirtualClock pre-aborted signal property tests", () => {
  test("setTimeout with an already-aborted signal returns -1 for any ms", () => {
    runProperty(anyDuration, (ms) => {
      const clock = new VirtualClock();
      const controller = new AbortController();
      controller.abort();
      if (clock.setTimeout(ms, () => {}, { signal: controller.signal }) !== -1) return false;
      if (clock.hasPending()) return false;
      return true;
    });
  });

  test("setInterval with an already-aborted signal returns -1 for any ms", () => {
    runProperty(fc.integer({ min: 1, max: 1000 }), (ms) => {
      const clock = new VirtualClock();
      const controller = new AbortController();
      controller.abort();
      if (clock.setInterval(ms, () => {}, { signal: controller.signal }) !== -1) return false;
      if (clock.hasPending()) return false;
      return true;
    });
  });
});
