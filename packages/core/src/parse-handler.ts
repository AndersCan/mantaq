import type { AnyActor } from "./actor-internal.ts";
import type { Context, EffectFn, TransitionResult } from "./actor-types.ts";
import type { InternalEvent } from "./index.ts";
import type { AnyStateRef } from "./state.ts";

export type RuntimeTransitionHandler<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  options: { context: Context<ActorContext>; actor: AnyActor<ActorContext> },
) => TransitionResult<States[number], string>;

/**
 * Boundary parser for transition handlers. Registration receives handlers
 * whose event parameter is the declared envelope of one concrete event. The
 * dispatcher stores and calls them with the runtime envelope. This function is
 * the single place where that widening happens.
 *
 * The runtime contract guarantees the envelope matches at dispatch time
 * (`Actor` only routes events whose `type` key was used at registration).
 */
export function parseTransitionHandler<States extends readonly AnyStateRef[], ActorContext>(
  candidate: unknown,
): RuntimeTransitionHandler<States, ActorContext> {
  const handler = candidate as RuntimeTransitionHandler<States, ActorContext> | undefined;
  if (typeof handler !== "function") {
    return () => ({});
  }
  return handler;
}

/**
 * Boundary parser for effect fns. Effects declare the payload of their state.
 * The runner hands over the same payload typed as `unknown`. This is the one
 * place where the payload type is restored.
 */
export function parseEffectFn<ActorContext>(candidate: unknown): EffectFn<ActorContext> {
  return candidate as EffectFn<ActorContext>;
}
