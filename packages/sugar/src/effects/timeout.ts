import type { Clock } from "@mantaq/core";

export function withTimeout(
  ms: number,
  input: {
    signal: AbortSignal;
    emit: (event: { id: string; [key: string]: unknown }) => void;
    clock: Clock;
  },
  event: () => { id: string; [key: string]: unknown },
): void {
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
