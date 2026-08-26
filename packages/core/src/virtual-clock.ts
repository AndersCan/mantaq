import { trackAbort, clearAbort, type Abortable } from "./abort-tracker.ts";
import type { ClockIntervalOptions, ClockTimerOptions } from "./clock.ts";

/**
 * Safety net for `advance()`: a timer callback that synchronously re-arms a
 * same-deadline (e.g. `setTimeout(0)`) timer would otherwise keep the firing
 * loop spinning forever. The bound therefore counts *consecutive* firings at
 * the same deadline — legitimate schedules (timers/intervals with distinct,
 * ever-advancing deadlines) fire in full, while a pathological same-deadline
 * re-arm chain is cut off so `advance()` can return
 */
const MAX_ADVANCE_ITERATIONS = 1_000_000;

interface TimerEntry extends Abortable {
  deadline: number;
  cb: () => void;
  eventName?: string;
}

interface IntervalEntry extends Abortable {
  ms: number;
  next: number;
  cb: () => void;
}

export interface VirtualClock {
  now(): number;
  setTimeout(ms: number, options: ClockTimerOptions): number;
  clearTimeout(id: number): void;
  setInterval(ms: number, options: ClockIntervalOptions): number;
  clearInterval(id: number): void;
  advance(ms: number): void;
  hasPending(): boolean;
  pendingTimers(): Array<{ id: number; deadline: number; ms: number; eventName?: string }>;
  setDrain(fn: () => void): void;
}

export function VirtualClock(): VirtualClock {
  let now = 0;
  const timers = new Map<number, TimerEntry>();
  const intervals = new Map<number, IntervalEntry>();
  let nextId = 1;
  const drains = new Set<() => void>();

  /**
   * Precondition guard for programmer errors. NaN and infinite delays are
   * unreachable-by-design inputs (an assert-style bad state), so they stop the
   * machine instead of flowing through as Either values.
   */
  function isFiniteDelay(delay: number, options: { method: string }): true {
    if (!Number.isFinite(delay)) {
      throw new RangeError(`[VirtualClock] invalid ${options.method} ms value: ${delay}`);
    }
    return true;
  }

  function normalizeDelay(delay: number, options: { method: string; interval: boolean }): number {
    isFiniteDelay(delay, { method: options.method });
    /**
     * Negative and zero values clamp like the platform: to 0 for timeouts, to
     * a 1ms floor for intervals (a 0ms interval would spin the synchronous
     * advance loop forever). Finite positive values schedule as requested.
     */
    return delay <= 0 ? (options.interval ? 1 : 0) : delay;
  }

  function findEarliestDeadline(target: number): number | undefined {
    let earliest = target;
    let found = false;
    for (const timer of timers.values()) {
      if (timer.deadline <= target && timer.deadline <= earliest) {
        earliest = timer.deadline;
        found = true;
      }
    }
    for (const interval of intervals.values()) {
      if (interval.next <= target && interval.next <= earliest) {
        earliest = interval.next;
        found = true;
      }
    }
    return found ? earliest : undefined;
  }

  function fireTimersAt(deadline: number): void {
    const dueIds: number[] = [];
    for (const [timerId, timer] of timers) {
      if (timer.deadline === deadline) dueIds.push(timerId);
    }
    for (const timerId of dueIds) {
      const timer = timers.get(timerId);
      if (timer) {
        clearAbort(timer);
        timers.delete(timerId);
        timer.cb();
      }
    }
  }

  function fireIntervalsAt(deadline: number): void {
    const dueIds: number[] = [];
    for (const [intervalId, interval] of intervals) {
      if (interval.next === deadline) dueIds.push(intervalId);
    }
    for (const intervalId of dueIds) {
      const interval = intervals.get(intervalId);
      if (interval) {
        interval.cb();
        if (intervals.has(intervalId)) {
          interval.next = now + interval.ms;
        }
      }
    }
  }

  return {
    now(): number {
      return now;
    },

    setTimeout(delay: number, { signal, cb, eventName }: ClockTimerOptions): number {
      if (signal?.aborted) return -1;
      const timerId = nextId++;
      const onAbort = trackAbort(signal, { timerId, entries: timers });
      timers.set(timerId, {
        deadline: now + normalizeDelay(delay, { method: "setTimeout", interval: false }),
        cb,
        signal,
        onAbort,
        eventName,
      });
      return timerId;
    },

    clearTimeout(timerId: number): void {
      const timer = timers.get(timerId);
      if (timer) {
        clearAbort(timer);
        timers.delete(timerId);
      }
    },

    setInterval(delay: number, { signal, cb }: ClockIntervalOptions): number {
      if (signal?.aborted) return -1;
      const intervalId = nextId++;
      const onAbort = trackAbort(signal, { timerId: intervalId, entries: intervals });
      const normalized = normalizeDelay(delay, { method: "setInterval", interval: true });
      intervals.set(intervalId, {
        ms: normalized,
        next: now + normalized,
        cb,
        signal,
        onAbort,
      });
      return intervalId;
    },

    clearInterval(intervalId: number): void {
      const interval = intervals.get(intervalId);
      if (interval) {
        clearAbort(interval);
        intervals.delete(intervalId);
      }
    },

    advance(delay: number): void {
      isFiniteDelay(delay, { method: "advance" });
      const target = now + Math.max(0, delay);

      let lastDeadline = -1;
      let sameDeadlineIterations = 0;
      while (true) {
        const deadline = findEarliestDeadline(target);
        if (deadline === undefined) break;
        if (deadline === lastDeadline) {
          if (++sameDeadlineIterations >= MAX_ADVANCE_ITERATIONS) break;
        } else {
          sameDeadlineIterations = 0;
          lastDeadline = deadline;
        }
        now = deadline;
        fireTimersAt(deadline);
        fireIntervalsAt(deadline);
      }

      now = target;
      for (const drain of drains) drain();
    },

    hasPending(): boolean {
      return timers.size > 0 || intervals.size > 0;
    },

    pendingTimers(): Array<{ id: number; deadline: number; ms: number; eventName?: string }> {
      const result: Array<{ id: number; deadline: number; ms: number; eventName?: string }> = [];
      for (const [timerId, timer] of timers) {
        result.push({
          id: timerId,
          deadline: timer.deadline,
          ms: timer.deadline - now,
          eventName: timer.eventName,
        });
      }
      return result;
    },

    /**
     * Register a post-advance drain callback. Multiple actors can share one
     * virtual clock, every registered drain runs (not just the last one), so
     * each actor is flushed regardless of construction order
     */
    setDrain(fn: () => void): void {
      drains.add(fn);
    },
  };
}
