export interface Abortable {
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function trackAbort(
  signal: AbortSignal | undefined,
  options: { timerId: number; entries: Map<number, Abortable> },
): (() => void) | undefined {
  const onAbort = signal
    ? () => {
        options.entries.delete(options.timerId);
      }
    : undefined;
  if (signal && onAbort) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return onAbort;
}

export function clearAbort(timer: Abortable): void {
  if (timer.signal && timer.onAbort) {
    timer.signal.removeEventListener("abort", timer.onAbort);
  }
}
