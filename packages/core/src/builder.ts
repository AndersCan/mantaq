import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import type { AnyActor } from "./actor-internal.ts";
import type { EffectFn, TransitionResult } from "./actor-types.ts";

type EventIdOf<E extends AnyEventRef> = E extends EventRef<infer Id, object | void> ? Id : never;

export type TransitionHandler<ActorContext> = (
  event: InternalEvent,
  opts: { context: ActorContext; actor: AnyActor },
) => TransitionResult;

export interface BuiltMaps<ActorContext> {
  transitions: Record<string, Record<string, TransitionHandler<ActorContext>>>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
}

export class ActorBuilder<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> {
  #transitions: BuiltMaps<ActorContext>["transitions"] = {};
  #effects: BuiltMaps<ActorContext>["effects"] = {};

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
    (this.#transitions[sName] ??= {})[eId] = fn as TransitionHandler<ActorContext>;
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
    (this.#transitions["Any"] ??= {})[eId] = fn as TransitionHandler<ActorContext>;
    return this;
  }

  effect<S extends States[number]>(stateRef: S, fn: EffectFn<ActorContext>): this {
    (this.#effects[stateRef.name] ??= []).push(fn);
    return this;
  }

  /** @internal */ build(): BuiltMaps<ActorContext> {
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
