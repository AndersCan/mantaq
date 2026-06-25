import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import type { AnyStateRef } from "./state.ts";
import type { Clock } from "./clock.ts";

export type { Snapshot } from "./actor-internal.ts";

export type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Id, infer P> ? CreatedOfEvent<Id, P> : never;

export type NonFinalStateRef<States extends AnyStateRef[]> = Extract<
  States[number],
  { isFinal: false }
>;

export interface EffectInput<ActorContext> {
  signal: AbortSignal;
  state: { name: string; payload: unknown };
  event: InternalEvent;
  context: ActorContext;
  emit: (event: InternalEvent) => void;
  clock: Clock;
}

export type EffectFn<ActorContext> = (input: EffectInput<ActorContext>) => void;

export type TransitionResult<
  AllowedState extends AnyStateRef = AnyStateRef,
  AllowedEmit extends string = string,
> = {
  state?: AllowedState | { state: AllowedState; payload?: unknown };
  payload?: unknown;
  emit?: Array<{ id: AllowedEmit }>;
};
