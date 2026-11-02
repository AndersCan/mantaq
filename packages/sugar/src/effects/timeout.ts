import type { EffectInput, InternalEvent } from "@mantaq/core";

export function withTimeout<
  ActorContext,
  Payload = unknown,
  Emit extends InternalEvent = InternalEvent,
>(
  durationMs: number,
  options: {
    input: EffectInput<ActorContext, Payload, Emit>;
    event: () => NoInfer<Emit>;
  },
): void {
  const { input, event } = options;
  input.clock.setTimeout(durationMs, {
    signal: input.signal,
    eventName: event().type,
    cb: () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
  });
}
