import type { EffectInput, AnyEventRef } from "@mantaq/core";

const IS_DEV =
  typeof process === "undefined" ||
  !process.env?.NODE_ENV ||
  process.env.NODE_ENV === "development";

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
  if (IS_DEV && (typeof ms !== "number" || ms < 0 || !Number.isFinite(ms))) {
    console.warn(`[withTimeout] invalid ms value: ${ms}. Timeout may not fire.`);
  }
  input.clock.setTimeout(ms, () => {
    if (input.signal.aborted) return;
    input.emit(event());
  });
}
