import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import type { AnyStateRef } from "./state.ts";
import type { Clock } from "./clock.ts";
import type { Context } from "./context.ts";

export type { Snapshot } from "./actor-internal.ts";

export type { Context } from "./context.ts";

export type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never;

export type NonFinalStateRef<States extends AnyStateRef[]> = Extract<
  States[number],
  { isFinal: false }
>;

export interface EffectInput<ActorContext, Payload = unknown> {
  signal: AbortSignal;
  state: { name: string; payload: Payload };
  event: InternalEvent;
  context: Context<ActorContext>;
  emit: (event: InternalEvent) => void;
  clock: Clock;
}

export type EffectFn<ActorContext, Payload = unknown> = (
  input: EffectInput<ActorContext, Payload>,
) => void;

export type TransitionResult<
  AllowedState extends AnyStateRef = AnyStateRef,
  AllowedEmit extends string = string,
> = {
  state?: AllowedState | { state: AllowedState; payload?: unknown };
  payload?: unknown;
  emit?: Array<{ type: AllowedEmit }>;
};
