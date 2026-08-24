import type { Clock } from "./clock.ts";

type ListenerEntry = { signal: AbortSignal; onAbort: () => void };

export class RealClock implements Clock {
  #start = Date.now();
  #listeners = new Map<number, ListenerEntry>();

  now(): number {
    return Date.now() - this.#start;
  }

  setTimeout(
    ms: number,
    cb: () => void,
    options?: { signal?: AbortSignal; eventName?: string },
  ): number {
    if (options?.signal?.aborted) return -1;
    const signal = options?.signal;
    const id = Number(
      globalThis.setTimeout(() => {
        this.#clearListener(id);
        cb();
      }, ms),
    );
    if (signal) {
      const onAbort = () => {
        globalThis.clearTimeout(id);
        this.#clearListener(id);
      };
      this.#listeners.set(id, { signal, onAbort });
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return id;
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
    this.#clearListener(id);
  }

  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    if (options?.signal?.aborted) return -1;
    const signal = options?.signal;
    const id = Number(globalThis.setInterval(cb, ms));
    if (signal) {
      const onAbort = () => {
        globalThis.clearInterval(id);
        this.#clearListener(id);
      };
      this.#listeners.set(id, { signal, onAbort });
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return id;
  }

  clearInterval(id: number): void {
    globalThis.clearInterval(id);
    this.#clearListener(id);
  }

  /** Detach the abort listener we registered for a timer, if any. */
  #clearListener(id: number): void {
    const entry = this.#listeners.get(id);
    if (!entry) return;
    entry.signal.removeEventListener("abort", entry.onAbort);
    this.#listeners.delete(id);
  }
}
