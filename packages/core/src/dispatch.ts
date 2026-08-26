import type { TransitionResult } from "./actor-types.ts";
import { type AnyStateRef } from "./state.ts";

export function parseTarget<S extends AnyStateRef>(
  step: TransitionResult<S, string>,
): { state: S; payload?: unknown } | undefined {
  const raw = step.state;
  if (!raw) return undefined;
  if ("state" in raw) {
    // { state, payload } envelope form.
    return { state: raw.state, payload: raw.payload };
  }
  return { state: raw, payload: step.payload };
}
