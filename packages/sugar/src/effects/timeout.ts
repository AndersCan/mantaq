import type { EffectInput, InternalEvent } from "@mantaq/core";

export function withTimeout<ActorContext>(
  ms: number,
  input: EffectInput<ActorContext>,
  event: () => InternalEvent,
): void {
  input.clock.setTimeout(
    ms,
    () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
    { signal: input.signal },
  );
}
