import type { Clock, EffectInput, InternalEvent } from "@mantaq/core";

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
  // A JS caller or a cast can reach here without a clock; the types do not allow it.
  const clock: Clock | undefined = Reflect.get(input, "clock");
  if (clock === undefined) {
    throw new Error(
      `withTimeout(${durationMs}): this actor has no clock. Pass the clock create() gets to Actor({ clock }).`,
    );
  }
  clock.setTimeout(durationMs, {
    signal: input.signal,
    eventName: event().type,
    cb: () => {
      if (input.signal.aborted) return;
      input.emit(event());
    },
  });
}
