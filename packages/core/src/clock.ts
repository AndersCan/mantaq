export interface Clock {
  setTimeout(
    ms: number,
    cb: () => void,
    options?: { signal?: AbortSignal; eventName?: string },
  ): number;
  clearTimeout(id: number): void;
  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number;
  clearInterval(id: number): void;
  now(): number;
  /** Optional hook for draining queues after clock advances (VirtualClock). */
  setDrain?(fn: () => void): void;
}
