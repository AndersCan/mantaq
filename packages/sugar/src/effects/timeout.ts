import type { EffectInput, AnyEventRef } from "@mantaq/core";

export function withTimeout<
  Inputs extends AnyEventRef[],
  Internal extends AnyEventRef[],
  ActorContext,
>(
  ms: number,
  input: EffectInput<Inputs, Internal, ActorContext>,
  event: () => EffectInput<Inputs, Internal, ActorContext>["emit"] extends (e: infer E) => void
    ? E
    : never,
): void {
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
