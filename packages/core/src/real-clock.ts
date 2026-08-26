import type { Clock, ClockIntervalOptions, ClockTimerOptions } from "./clock.ts";

type ListenerEntry = { signal: AbortSignal; onAbort: () => void };

export function RealClock(): Clock {
  const start = Date.now();
  const listeners = new Map<number, ListenerEntry>();

  function clearListener(listenerId: number): void {
    const entry = listeners.get(listenerId);
    if (!entry) return;
    entry.signal.removeEventListener("abort", entry.onAbort);
    listeners.delete(listenerId);
  }

  return {
    now(): number {
      return Date.now() - start;
    },

    setTimeout(delay: number, { signal, cb }: ClockTimerOptions): number {
      if (signal?.aborted) return -1;
      const timerId = Number(
        globalThis.setTimeout(() => {
          clearListener(timerId);
          cb();
        }, delay),
      );
      if (signal) {
        function onAbort(): void {
          globalThis.clearTimeout(timerId);
          clearListener(timerId);
        }
        listeners.set(timerId, { signal, onAbort });
        // Stryker disable next-line ObjectLiteral,BooleanLiteral -- `onAbort` removes its own listener via `clearListener`, so the `once` flag is redundant; with or without it the handler runs exactly once per abort.
        signal.addEventListener("abort", onAbort, { once: true });
      }
      return timerId;
    },

    clearTimeout(timerId: number): void {
      globalThis.clearTimeout(timerId);
      clearListener(timerId);
    },

    setInterval(delay: number, { signal, cb }: ClockIntervalOptions): number {
      if (signal?.aborted) return -1;
      const intervalId = Number(globalThis.setInterval(cb, delay));
      if (signal) {
        function onAbort(): void {
          globalThis.clearInterval(intervalId);
          clearListener(intervalId);
        }
        listeners.set(intervalId, { signal, onAbort });
        // Stryker disable next-line ObjectLiteral,BooleanLiteral -- `onAbort` removes its own listener via `clearListener`, so the `once` flag is redundant; with or without it the handler runs exactly once per abort.
        signal.addEventListener("abort", onAbort, { once: true });
      }
      return intervalId;
    },

    clearInterval(intervalId: number): void {
      globalThis.clearInterval(intervalId);
      clearListener(intervalId);
    },
  };
}
