import { VirtualClock } from "./virtual-clock.ts";
import { fc, anyDuration, anySmallDuration, runProperty } from "@mantaq/pbt";
import { test, describe } from "vite-plus/test";

interface TimerJob {
  id: number;
  ms: number;
}

interface IntervalJob {
  id: number;
  ms: number;
  next: number;
}

function referenceRun(options: {
  timers: TimerJob[];
  intervals: IntervalJob[];
  target: number;
}): string[] {
  const { timers, intervals, target } = options;
  const events: string[] = [];
  const remaining = timers.map((job) => ({ ...job, fired: false }));
  const active = intervals.map((intervalJob) => ({ ...intervalJob }));
  while (true) {
    let earliest: number | undefined;
    for (const job of remaining) {
      if (!job.fired && job.ms <= target && (earliest === undefined || job.ms <= earliest)) {
        earliest = job.ms;
      }
    }
    for (const intervalJob of active) {
      if (intervalJob.next <= target && (earliest === undefined || intervalJob.next <= earliest)) {
        earliest = intervalJob.next;
      }
    }
    if (earliest === undefined) break;
    for (const job of remaining) {
      if (!job.fired && job.ms === earliest) {
        job.fired = true;
        events.push(`t${job.id}`);
      }
    }
    for (const intervalJob of active) {
      if (intervalJob.next === earliest) {
        events.push(`idx${intervalJob.id}`);
        intervalJob.next = earliest + intervalJob.ms;
      }
    }
  }
  return events;
}

function referencePending(options: {
  timers: TimerJob[];
  intervals: IntervalJob[];
  target: number;
}): boolean {
  return options.timers.some((job) => job.ms > options.target) || options.intervals.length > 0;
}

describe("VirtualClock property tests", () => {
  test("timers and intervals call back exactly per deadline for any schedule", () => {
    runProperty(
      fc.tuple(
        fc.array(anyDuration, { maxLength: 6 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 4 }),
        anyDuration,
      ),
      ([timerDurations, intervalDurations, target]) => {
        const clock = VirtualClock();
        const events: string[] = [];
        const timers: TimerJob[] = [];
        for (const duration of timerDurations) {
          const timerId = clock.setTimeout(duration, { cb: () => events.push(`t${timerId}`) });
          timers.push({ id: timerId, ms: duration });
        }
        const intervals: IntervalJob[] = [];
        for (const duration of intervalDurations) {
          const timerId = clock.setInterval(duration, { cb: () => events.push(`idx${timerId}`) });
          intervals.push({ id: timerId, ms: duration, next: duration });
        }

        clock.advance(target);

        const expected = referenceRun({ timers, intervals, target });
        if (events.join(",") !== expected.join(",")) return false;

        const expectedPending = referencePending({ timers, intervals, target });
        if (clock.hasPending() !== expectedPending) return false;

        if (clock.now() !== target) return false;

        return true;
      },
    );
  });

  test("property runs never let aborted or cleared timers call back", () => {
    runProperty(
      fc.tuple(
        fc.array(anyDuration, { maxLength: 6 }),
        fc.array(fc.boolean(), { maxLength: 6 }),
        anyDuration,
      ),
      ([durations, aborted, target]) => {
        const clock = VirtualClock();
        const fired = new Set<number>();
        const controllers = new Map<number, AbortController>();
        for (let index = 0; index < durations.length; index++) {
          const controller = new AbortController();
          const timerId = clock.setTimeout(durations[index], {
            cb: () => {
              fired.add(timerId);
            },
            signal: controller.signal,
          });
          controllers.set(timerId, controller);
          if (aborted[index] === true) controller.abort();
        }

        clock.advance(target);

        for (const timerId of controllers.keys()) {
          if (controllers.get(timerId)?.signal.aborted) {
            if (fired.has(timerId)) return false;
          } else if (durations[timerId - 1] <= target) {
            if (!fired.has(timerId)) return false;
          }
        }
        return true;
      },
    );
  });
});

function withNumericDesc(first: number, ...rest: number[]): number {
  const second = rest[0] ?? 0;
  return second - first;
}

describe("VirtualClock firing-order property tests", () => {
  test("timers call back in deadline order regardless of registration order", () => {
    runProperty(
      fc.tuple(fc.array(anySmallDuration, { minLength: 2, maxLength: 12 }), anyDuration),
      ([deadlines, target]) => {
        const clock = VirtualClock();
        const fired: Array<{ ms: number }> = [];
        for (const deadline of deadlines) {
          clock.setTimeout(deadline, { cb: () => fired.push({ ms: deadline }) });
        }

        clock.advance(target);

        const pendingJobs: Array<{ ms: number; orderIndex: number }> = [];
        for (let orderIndex = 0; orderIndex < deadlines.length; orderIndex++) {
          const deadline = deadlines[orderIndex];
          if (deadline !== undefined && deadline <= target)
            pendingJobs.push({ ms: deadline, orderIndex });
        }
        const expectedOrder: number[] = [];
        while (pendingJobs.length > 0) {
          let minIdx = 0;
          for (let scanIdx = 1; scanIdx < pendingJobs.length; scanIdx++) {
            const candidate = pendingJobs[scanIdx];
            const best = pendingJobs[minIdx];
            if (candidate === undefined || best === undefined) return false;
            if (
              candidate.ms < best.ms ||
              (candidate.ms === best.ms && candidate.orderIndex < best.orderIndex)
            ) {
              minIdx = scanIdx;
            }
          }
          const chosen = pendingJobs.splice(minIdx, 1)[0];
          if (chosen) expectedOrder.push(chosen.ms);
        }
        if (fired.length !== expectedOrder.length) return false;
        for (let index = 0; index < expectedOrder.length; index++) {
          const firedAt = fired[index];
          if (!firedAt || firedAt.ms !== expectedOrder[index]) return false;
        }
        return true;
      },
    );
  });

  test("timers registered in reverse deadline order still call back in time order", () => {
    runProperty(
      fc.tuple(fc.array(anySmallDuration, { minLength: 2, maxLength: 12 }), anyDuration),
      ([durations, target]) => {
        const deadlines = [...durations].sort(withNumericDesc);
        const clock = VirtualClock();
        const fired: Array<{ ms: number }> = [];
        for (const deadline of deadlines) {
          clock.setTimeout(deadline, { cb: () => fired.push({ ms: deadline }) });
        }

        clock.advance(target);

        const pendingJobs: Array<{ ms: number; orderIndex: number }> = [];
        for (let orderIndex = 0; orderIndex < deadlines.length; orderIndex++) {
          const deadline = deadlines[orderIndex];
          if (deadline !== undefined && deadline <= target)
            pendingJobs.push({ ms: deadline, orderIndex });
        }
        const expectedOrder: number[] = [];
        while (pendingJobs.length > 0) {
          let minIdx = 0;
          for (let scanIdx = 1; scanIdx < pendingJobs.length; scanIdx++) {
            const candidate = pendingJobs[scanIdx];
            const best = pendingJobs[minIdx];
            if (candidate === undefined || best === undefined) return false;
            if (
              candidate.ms < best.ms ||
              (candidate.ms === best.ms && candidate.orderIndex < best.orderIndex)
            ) {
              minIdx = scanIdx;
            }
          }
          const chosen = pendingJobs.splice(minIdx, 1)[0];
          if (chosen) expectedOrder.push(chosen.ms);
        }
        if (fired.length !== expectedOrder.length) return false;
        for (let index = 0; index < expectedOrder.length; index++) {
          const firedAt = fired[index];
          if (!firedAt || firedAt.ms !== expectedOrder[index]) return false;
        }
        return true;
      },
    );
  });
});

describe("VirtualClock boundary property tests", () => {
  test("timers scheduled at or around the advance target call back exactly", () => {
    runProperty(
      fc.tuple(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(fc.integer({ min: -2, max: 2 }), { maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 3 }),
      ),
      ([target, offsets, intervalDurations]) => {
        const clock = VirtualClock();
        const events: string[] = [];
        const timers: TimerJob[] = [];
        for (const offset of offsets) {
          const deadline = Math.max(0, target + offset);
          const timerId = clock.setTimeout(deadline, { cb: () => events.push(`t${timerId}`) });
          timers.push({ id: timerId, ms: deadline });
        }
        const intervals: IntervalJob[] = [];
        for (const duration of intervalDurations) {
          const timerId = clock.setInterval(duration, { cb: () => events.push(`idx${timerId}`) });
          intervals.push({ id: timerId, ms: duration, next: duration });
        }

        clock.advance(target);

        const expected = referenceRun({ timers, intervals, target });
        return events.join(",") === expected.join(",");
      },
    );
  });
});

describe("VirtualClock pre-aborted signal property tests", () => {
  test("setTimeout with an already-aborted signal returns -1 for any ms", () => {
    runProperty(anyDuration, (duration) => {
      const clock = VirtualClock();
      const controller = new AbortController();
      controller.abort();
      if (clock.setTimeout(duration, { signal: controller.signal, cb: () => {} }) !== -1) {
        return false;
      }
      if (clock.hasPending()) return false;
      return true;
    });
  });

  test("setInterval with an already-aborted signal returns -1 for any ms", () => {
    runProperty(fc.integer({ min: 1, max: 1000 }), (duration) => {
      const clock = VirtualClock();
      const controller = new AbortController();
      controller.abort();
      if (clock.setInterval(duration, { signal: controller.signal, cb: () => {} }) !== -1) {
        return false;
      }
      if (clock.hasPending()) return false;
      return true;
    });
  });
});
