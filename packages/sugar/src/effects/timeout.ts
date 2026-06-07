import type { EffectInput } from "@mantaq/core";

export function withTimeout(
  ms: number,
  input: EffectInput<any, any, any>,
  event: () => { id: string; [key: string]: unknown },
): void {
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
