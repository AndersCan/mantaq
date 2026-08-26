export type InternalEvent = { type: string; payload?: unknown };

export { Actor } from "./actor.ts";
export { RealClock, VirtualClock } from "./actor.ts";
export type { Clock, Snapshot, AnyActor, ActorOptions, InitialState } from "./actor.ts";
export { Context } from "./context.ts";
export type {
  ActorBuilder,
  SetupFn,
  BuiltMaps,
  PayloadOf,
  EventTypeOf,
  TransitionHandler,
} from "./builder.ts";
export { state, StateRef, isStateRef } from "./state.ts";
export type { AnyStateRef } from "./state.ts";
export { event, EventRef } from "./event.ts";
export type { AnyEventRef, CreatedOfEvent } from "./event.ts";
export type { EffectInput, EffectFn, NonFinalStateRef, CreatedOf } from "./actor-types.ts";
export type {
  ErrorInfo,
  ErrorState,
  ErrorReason,
  TransitionResult,
  TransitionInfo,
} from "./actor-types.ts";
