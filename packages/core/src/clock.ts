export interface Clock {
  setTimeout(ms: number, options: ClockTimerOptions): number;
  clearTimeout(id: number): void;
  setInterval(ms: number, options: ClockIntervalOptions): number;
  clearInterval(id: number): void;
  now(): number;
  /** Optional hook for draining queues after clock advances (VirtualClock). */
  setDrain?(fn: () => void): void;
}

export interface ClockTimerOptions {
  cb: () => void;
  signal?: AbortSignal;
  eventName?: string;
}

export interface ClockIntervalOptions {
  cb: () => void;
  signal?: AbortSignal;
}
