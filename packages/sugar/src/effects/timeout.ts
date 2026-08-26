import type { EffectInput, InternalEvent } from "@mantaq/core";

export function withTimeout<ActorContext>(
  durationMs: number,
  options: {
    input: EffectInput<ActorContext>;
    event: () => InternalEvent;
  },
): void {
  const { input, event } = options;
  input.clock.setTimeout(durationMs, {
    signal: input.signal,
    cb: () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
  });
}
