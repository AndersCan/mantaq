import type { EffectInput, AnyEventRef } from "@mantaq/core";
import { isAborted } from "@mantaq/utils";

type EmitEvent<
  Inputs extends AnyEventRef[],
  Internal extends AnyEventRef[],
  ActorContext,
> = EffectInput<Inputs, Internal, ActorContext>["emit"] extends (e: infer E) => void ? E : never;

export function withTimeout<
  Inputs extends AnyEventRef[],
  Internal extends AnyEventRef[],
  ActorContext,
>(
  ms: number,
  input: EffectInput<Inputs, Internal, ActorContext>,
  event: () => EmitEvent<Inputs, Internal, ActorContext>,
): void {
  input.clock.setTimeout(ms, () => {
    if (isAborted(input.signal)) return;
    input.emit(event());
  });
}
