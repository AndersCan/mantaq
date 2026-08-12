import type { Clock } from "./clock.ts";
import { trackAbort, clearAbort, type Abortable } from "./abort-tracker.ts";

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
  #drain: (() => void) | null = null;

  now(): number {
    return this.#now;
  }

  /**
   * Platform-matching delay clamp (like setTimeout/setInterval):
   * NaN, negative, and 0 clamp to 0; values above the 32-bit max clamp to 1.
   * Intervals additionally enforce a 1ms floor — a 0ms interval would spin the
   * synchronous advance loop forever.
   */
  #delay(ms: number, interval: boolean): number {
    if (!(ms > 0)) return interval ? 1 : 0;
    if (ms > 2_147_483_647) return 1;
    return ms;
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
      deadline: this.#now + this.#delay(ms, false),
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
    this.#intervals.set(id, {
      ms: this.#delay(ms, true),
      next: this.#now + this.#delay(ms, true),
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
    const delta = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const target = this.#now + delta;

    while (true) {
      const deadline = this.#findEarliestDeadline(target);
      if (deadline === null) break;
      this.#now = deadline;
      this.#fireTimersAt(deadline);
      this.#fireIntervalsAt(deadline);
    }

    this.#now = target;
    this.#drain?.();
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

  setDrain(fn: () => void): void {
    this.#drain = fn;
  }
}
