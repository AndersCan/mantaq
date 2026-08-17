import type { Clock } from "./clock.ts";

export class RealClock implements Clock {
  #start = Date.now();

  now(): number {
    return Date.now() - this.#start;
  }

  setTimeout(
    ms: number,
    cb: () => void,
    options?: { signal?: AbortSignal; eventName?: string },
  ): number {
    if (options?.signal?.aborted) return -1;
    let onAbort: (() => void) | undefined;
    const id = Number(
      globalThis.setTimeout(() => {
        if (onAbort && options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        cb();
      }, ms),
    );
    if (options?.signal) {
      onAbort = () => globalThis.clearTimeout(id);
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    return id;
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
  }

  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const id = Number(globalThis.setInterval(cb, ms));
    if (options?.signal) {
      const onAbort = () => globalThis.clearInterval(id);
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    return id;
  }

  clearInterval(id: number): void {
    globalThis.clearInterval(id);
  }
}
