import { StateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import type { InternalEvent } from "./event.ts";
import type { AnyActor } from "./actor-internal.ts";
import type { TransitionResult } from "./actor-types.ts";

export type TransitionFn = (
  event: InternalEvent,
  options: { context: unknown; actor: AnyActor },
) => TransitionResult;

export function parseTarget<S extends AnyStateRef>(
  step: TransitionResult<S, string>,
): { state: S; payload?: unknown } | undefined {
  if (!step.state) return undefined;
  if (step.state instanceof StateRef) {
    return { state: step.state, payload: step.payload };
  }
  return { state: step.state.state, payload: step.state.payload };
}
