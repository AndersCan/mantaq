import type { AnyStateRef, StateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import type { AnyActor } from "./actor-internal.ts";
import type { Context, EffectFn, TransitionResult } from "./actor-types.ts";

export type EventTypeOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, object | void> ? Type : never;

export type PayloadOf<S extends AnyStateRef> =
  S extends StateRef<infer _Name, infer Payload, infer _IsFinal> ? Payload : never;

export type TransitionHandler<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  opts: { context: Context<ActorContext>; actor: AnyActor },
) => TransitionResult<States[number], string>;

export interface BuiltMaps<States extends readonly AnyStateRef[], ActorContext> {
  transitions: Record<string, Record<string, TransitionHandler<States, ActorContext>>>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
}

export class ActorBuilder<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> {
  #transitions: BuiltMaps<States, ActorContext>["transitions"] = {};
  #effects: BuiltMaps<States, ActorContext>["effects"] = {};

  on<S extends States[number], E extends Inputs[number] | Internal[number]>(
    stateRef: S,
    eventRef: E,
    fn: (
      event: E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never,
      opts: { context: Context<ActorContext>; actor: AnyActor },
    ) => TransitionResult<States[number], EventTypeOf<Outputs[number]>>,
  ): this {
    const sName = stateRef.name;
    const eType = eventRef.type;
    if (this.#transitions[sName]?.[eType]) {
      throw new Error(
        `[ActorBuilder] duplicate transition handler for state "${sName}" event "${eType}"`,
      );
    }
    (this.#transitions[sName] ??= {})[eType] = fn as (
      event: unknown,
      opts: { context: Context<ActorContext>; actor: AnyActor },
    ) => TransitionResult<States[number], string>;
    return this;
  }

  onAny<E extends Inputs[number] | Internal[number]>(
    eventRef: E,
    fn: (
      event: E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never,
      opts: { context: Context<ActorContext>; actor: AnyActor },
    ) => TransitionResult<States[number], EventTypeOf<Outputs[number]>>,
  ): this {
    const eType = eventRef.type;
    if (this.#transitions["Any"]?.[eType]) {
      throw new Error(`[ActorBuilder] duplicate Any-handler for event "${eType}"`);
    }
    (this.#transitions["Any"] ??= {})[eType] = fn as (
      event: unknown,
      opts: { context: Context<ActorContext>; actor: AnyActor },
    ) => TransitionResult<States[number], string>;
    return this;
  }

  effect<S extends States[number]>(stateRef: S, fn: EffectFn<ActorContext, PayloadOf<S>>): this {
    (this.#effects[stateRef.name] ??= []).push(fn as EffectFn<ActorContext>);
    return this;
  }

  /** @internal */ build(): BuiltMaps<States, ActorContext> {
    return { transitions: this.#transitions, effects: this.#effects };
  }
}

export type SetupFn<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = (m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>) => void;
