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
      deadline: this.#now + ms,
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
    this.#intervals.set(id, { ms, next: this.#now + ms, cb, signal, onAbort });
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

  #collectMatchingIds<T>(map: Map<number, T>, match: (entry: T) => boolean): number[] {
    const ids: number[] = [];
    for (const [id, entry] of map) {
      if (match(entry)) ids.push(id);
    }
    return ids;
  }

  #fireTimersAt(deadline: number): void {
    for (const id of this.#collectMatchingIds(this.#timers, (t) => t.deadline === deadline)) {
      const timer = this.#timers.get(id);
      if (timer) {
        clearAbort(timer);
        this.#timers.delete(id);
        timer.cb();
      }
    }
  }

  #fireIntervalsAt(deadline: number): void {
    for (const id of this.#collectMatchingIds(this.#intervals, (t) => t.next === deadline)) {
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
    const target = this.#now + ms;

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
