export interface Abortable {
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function trackAbort(
  signal: AbortSignal | undefined,
  id: number,
  map: Map<number, Abortable>,
): (() => void) | undefined {
  const onAbort = signal
    ? () => {
        map.delete(id);
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
