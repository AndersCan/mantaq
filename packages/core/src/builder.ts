import type { AnyActor } from "./actor-internal.ts";
import type { Context, EffectFn, TransitionResult } from "./actor-types.ts";
import type { AnyEventRef, EventRef, CreatedOfEvent } from "./index.ts";
import type { RuntimeTransitionHandler } from "./parse-handler.ts";
import { parseEffectFn, parseTransitionHandler } from "./parse-handler.ts";
import type { AnyStateRef, StateRef } from "./state.ts";

export type EventTypeOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, object | void> ? Type : never;

export type PayloadOf<S extends AnyStateRef> =
  S extends StateRef<infer _Name, infer Payload, infer _IsFinal> ? Payload : never;

export type TransitionHandler<
  States extends readonly AnyStateRef[],
  ActorContext,
> = RuntimeTransitionHandler<States, ActorContext>;

export interface EffectEntry<ActorContext> {
  name: string;
  fn: EffectFn<ActorContext>;
}

export interface BuiltMaps<States extends readonly AnyStateRef[], ActorContext> {
  transitions: Record<string, Record<string, TransitionHandler<States, ActorContext>>>;
  effects: Record<string, Array<EffectEntry<ActorContext>>>;
}

type HandlerFn<
  States extends readonly AnyStateRef[],
  _InputsInternal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  E extends AnyEventRef,
> = (
  event: E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never,
  opts: { context: Context<ActorContext>; actor: AnyActor<ActorContext> },
) => TransitionResult<States[number], EventTypeOf<Outputs[number]>>;

export interface ActorBuilder<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> {
  on<S extends States[number], E extends Inputs[number] | Internal[number]>(
    stateRef: S,
    options: {
      eventRef: E;
      handler: HandlerFn<States, Inputs | Internal, Outputs, ActorContext, E>;
    },
  ): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>;
  onAny<E extends Inputs[number] | Internal[number]>(options: {
    eventRef: E;
    handler: HandlerFn<States, Inputs | Internal, Outputs, ActorContext, E>;
  }): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>;
  effect<S extends States[number]>(
    stateRef: S,
    definition: { name: string; fn: EffectFn<ActorContext, PayloadOf<S>> },
  ): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>;
  /** @internal */
  build(): BuiltMaps<States, ActorContext>;
}

export function ActorBuilder<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
>(): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
  const transitions: BuiltMaps<States, ActorContext>["transitions"] = {};
  const effects: BuiltMaps<States, ActorContext>["effects"] = {};

  const self: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> = {
    on(
      stateRef,
      { eventRef, handler },
    ): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
      const stateName = stateRef.name;
      const eventType = eventRef.type;
      (transitions[stateName] ??= {})[eventType] = parseTransitionHandler(handler);
      return self;
    },

    onAny(options): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
      const eventType = options.eventRef.type;
      (transitions["Any"] ??= {})[eventType] = parseTransitionHandler(options.handler);
      return self;
    },

    effect(stateRef, { name, fn }) {
      (effects[stateRef.name] ??= []).push({
        name,
        fn: parseEffectFn(fn),
      });
      return self;
    },

    build(): BuiltMaps<States, ActorContext> {
      return { transitions, effects };
    },
  };
  return self;
}

export type SetupFn<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = (m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>) => void;
