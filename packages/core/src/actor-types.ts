import type { Clock } from "./clock.ts";
import type { Context } from "./context.ts";
import type { EventRef, CreatedOfEvent, InternalEvent } from "./index.ts";
import type { AnyStateRef, StateRef } from "./state.ts";

export type { Snapshot } from "./actor-internal.ts";
export type { Context };

export type CreatedOf<E extends EventRef<string, object | void>> =
  E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never;

export type NonFinalStateRef<States extends AnyStateRef[]> = Extract<
  States[number],
  { isFinal: false }
>;

/** `clock` is there only when the actor was given one (`Time` is a `Clock`). */
export type EffectInput<
  ActorContext,
  Payload = unknown,
  Emit = InternalEvent,
  Time extends Clock | undefined = Clock,
> = {
  signal: AbortSignal;
  state: { name: string; payload: Payload };
  event: InternalEvent;
  context: Context<ActorContext>;
  emit: (event: Emit) => void;
} & ([Time] extends [Clock] ? { clock: Clock } : {});

export type EffectFn<
  ActorContext,
  Payload = unknown,
  Emit = InternalEvent,
  Time extends Clock | undefined = Clock,
> = (
  input: EffectInput<ActorContext, Payload, Emit, Time>,
) => void | Promise<void> | { then(onFulfilled: unknown, onRejected: unknown): unknown };
export type ErrorReason =
  | "transition"
  | "effect"
  | "budget"
  | "output"
  | "internal"
  | "async"
  | "unhandled";

export interface ErrorInfo {
  error: unknown;
  state: AnyStateRef;
  context: unknown;
  event: InternalEvent;
  reason: ErrorReason;
}

export interface TransitionInfo {
  event: InternalEvent;
  from: string;
  to: string;
  transitioned: boolean;
  /** Names of effects invoked on entry into `to`, in registration order. */
  effects: string[];
}
export type ErrorState = StateRef<"__error", unknown, true>;

export interface LastKnownState {
  state: AnyStateRef;
  context: unknown;
}
export type TransitionResult<
  AllowedState extends AnyStateRef = AnyStateRef,
  AllowedEmit extends string = string,
> = {
  state?: AllowedState | { state: AllowedState; payload?: unknown };
  payload?: unknown;
  emit?: Array<{ type: AllowedEmit; payload?: unknown }>;
};
