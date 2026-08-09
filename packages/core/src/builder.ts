import type { AnyStateRef, StateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import type { AnyActor } from "./actor-internal.ts";
import type { EffectFn, TransitionResult } from "./actor-types.ts";

type EventIdOf<E extends AnyEventRef> = E extends EventRef<infer Id, object | void> ? Id : never;

type PayloadOf<S extends AnyStateRef> =
  S extends StateRef<infer _Name, infer Payload, infer _IsFinal> ? Payload : never;

type TransitionHandler<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  opts: { context: ActorContext; actor: AnyActor },
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
      event: E extends EventRef<infer Id, infer P> ? CreatedOfEvent<Id, P> : never,
      opts: { context: ActorContext; actor: AnyActor },
    ) => TransitionResult<States[number], EventIdOf<Outputs[number]>>,
  ): this {
    const sName = stateRef.name;
    const eId = eventRef.id;
    (this.#transitions[sName] ??= {})[eId] = fn as (
      event: unknown,
      opts: { context: ActorContext; actor: AnyActor },
    ) => TransitionResult<States[number], string>;
    return this;
  }

  onAny<E extends Inputs[number] | Internal[number]>(
    eventRef: E,
    fn: (
      event: E extends EventRef<infer Id, infer P> ? CreatedOfEvent<Id, P> : never,
      opts: { context: ActorContext; actor: AnyActor },
    ) => TransitionResult<States[number], EventIdOf<Outputs[number]>>,
  ): this {
    const eId = eventRef.id;
    (this.#transitions["Any"] ??= {})[eId] = fn as (
      event: unknown,
      opts: { context: ActorContext; actor: AnyActor },
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
