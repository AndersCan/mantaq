import type { EffectInput, InternalEvent } from "@mantaq/core";

export function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  if (!Number.isFinite(ms) || ms < 0) {
    console.warn(`[withTimeout] invalid ms value: ${ms}. Timeout skipped.`);
    return;
  }
  input.clock.setTimeout(
    ms,
    () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
    { signal: input.signal },
  );
}
