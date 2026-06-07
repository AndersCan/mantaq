import type { EffectInput, AnyEventRef } from "@mantaq/core";

export function withTimeout<
  Inputs extends AnyEventRef[],
  Internal extends AnyEventRef[],
  ActorContext,
>(
  ms: number,
  input: EffectInput<Inputs, Internal, ActorContext>,
  event: () => { id: string; [key: string]: unknown },
): void {
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
