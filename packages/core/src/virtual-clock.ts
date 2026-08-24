import type { Clock } from "./clock.ts";
import { trackAbort, clearAbort, type Abortable } from "./abort-tracker.ts";

/**
 * Safety net for `advance()`: a timer callback that synchronously re-arms a
 * same-deadline (e.g. `setTimeout(0)`) timer would otherwise keep the firing
 * loop spinning forever. The bound therefore counts *consecutive* firings at
 * the same deadline — legitimate schedules (timers/intervals with distinct,
 * ever-advancing deadlines) fire in full, while a pathological same-deadline
 * re-arm chain is cut off so `advance()` can return.
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

export class VirtualClock implements Clock {
  #now = 0;
  #timers = new Map<number, TimerEntry>();
  #intervals = new Map<number, IntervalEntry>();
  #nextId = 1;
  #drains = new Set<() => void>();

  now(): number {
    return this.#now;
  }

  /**
   * Delay normalization: NaN and ±Infinity throw (programmer error); negative
   * and 0 clamp to 0 for timeouts like the platform, to a 1ms floor for
   * intervals (a 0ms interval would spin the synchronous advance loop
   * forever). Finite positive values schedule at their real deadline.
   */
  #delay(ms: number, method: string, interval: boolean): number {
    if (!Number.isFinite(ms)) {
      throw new RangeError(`[VirtualClock] invalid ${method} ms value: ${ms}`);
    }
    return ms <= 0 ? (interval ? 1 : 0) : ms;
  }

  setTimeout(
    ms: number,
    cb: () => void,
    options?: { signal?: AbortSignal; eventName?: string },
  ): number {
    const signal = options?.signal;
    if (signal?.aborted) return -1;
    const id = this.#nextId++;
    const onAbort = trackAbort(signal, id, this.#timers);
    this.#timers.set(id, {
      deadline: this.#now + this.#delay(ms, "setTimeout", false),
      cb,
      signal,
      onAbort,
      eventName: options?.eventName,
    });
    return id;
  }

  clearTimeout(id: number): void {
    const timer = this.#timers.get(id);
    if (timer) {
      clearAbort(timer);
      this.#timers.delete(id);
    }
  }

  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const signal = options?.signal;
    if (signal?.aborted) return -1;
    const id = this.#nextId++;
    const onAbort = trackAbort(signal, id, this.#intervals);
    const d = this.#delay(ms, "setInterval", true);
    this.#intervals.set(id, {
      ms: d,
      next: this.#now + d,
      cb,
      signal,
      onAbort,
    });
    return id;
  }

  clearInterval(id: number): void {
    const interval = this.#intervals.get(id);
    if (interval) {
      clearAbort(interval);
      this.#intervals.delete(id);
    }
  }

  #findEarliestDeadline(target: number): number | null {
    let earliest = target;
    let found = false;
    for (const t of this.#timers.values()) {
      if (t.deadline <= target && t.deadline <= earliest) {
        earliest = t.deadline;
        found = true;
      }
    }
    for (const t of this.#intervals.values()) {
      if (t.next <= target && t.next <= earliest) {
        earliest = t.next;
        found = true;
      }
    }
    return found ? earliest : null;
  }

  #fireTimersAt(deadline: number): void {
    const ids: number[] = [];
    for (const [id, t] of this.#timers) {
      if (t.deadline === deadline) ids.push(id);
    }
    for (const id of ids) {
      const timer = this.#timers.get(id);
      if (timer) {
        clearAbort(timer);
        this.#timers.delete(id);
        timer.cb();
      }
    }
  }

  #fireIntervalsAt(deadline: number): void {
    const ids: number[] = [];
    for (const [id, t] of this.#intervals) {
      if (t.next === deadline) ids.push(id);
    }
    for (const id of ids) {
      const interval = this.#intervals.get(id);
      if (interval) {
        interval.cb();
        if (this.#intervals.has(id)) {
          interval.next = this.#now + interval.ms;
        }
      }
    }
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms)) {
      throw new RangeError(`[VirtualClock] invalid advance ms value: ${ms}`);
    }
    const target = this.#now + Math.max(0, ms);

    let lastDeadline = -1;
    let sameDeadlineIterations = 0;
    while (true) {
      const deadline = this.#findEarliestDeadline(target);
      if (deadline === null) break;
      if (deadline === lastDeadline) {
        if (++sameDeadlineIterations >= MAX_ADVANCE_ITERATIONS) break;
      } else {
        sameDeadlineIterations = 0;
        lastDeadline = deadline;
      }
      this.#now = deadline;
      this.#fireTimersAt(deadline);
      this.#fireIntervalsAt(deadline);
    }

    this.#now = target;
    for (const drain of this.#drains) drain();
  }

  hasPending(): boolean {
    return this.#timers.size > 0 || this.#intervals.size > 0;
  }

  pendingTimers(): Array<{ id: number; deadline: number; ms: number; eventName?: string }> {
    const result: Array<{ id: number; deadline: number; ms: number; eventName?: string }> = [];
    for (const [id, t] of this.#timers) {
      result.push({ id, deadline: t.deadline, ms: t.deadline - this.#now, eventName: t.eventName });
    }
    return result;
  }

  /**
   * Register a post-advance drain callback. Multiple actors can share one
   * `VirtualClock`; every registered drain runs (not just the last one), so
   * each actor is flushed regardless of construction order.
   */
  setDrain(fn: () => void): void {
    this.#drains.add(fn);
  }
}
