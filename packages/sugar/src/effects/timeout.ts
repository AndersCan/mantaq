import type { EffectInput, InternalEvent } from "@mantaq/core";

export function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  if (typeof ms !== "number" || ms < 0 || !Number.isFinite(ms)) {
    console.warn(`[withTimeout] invalid ms value: ${ms}. Timeout may not fire.`);
  }
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
