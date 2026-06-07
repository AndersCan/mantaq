import type { EffectInput, AnyEventRef } from "@mantaq/core";
import { isAborted } from "@mantaq/utils";

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
    if (isAborted(input.signal)) return;
    input.emit(event());
  });
}
