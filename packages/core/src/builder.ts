import type { AnyActor } from "./actor-internal.ts";
import type { Context, CreatedOf, EffectFn, TransitionResult } from "./actor-types.ts";
import type { AnyEventRef, EventRef, CreatedOfEvent, InternalEvent } from "./index.ts";
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
  sends?: string[]; // declared event types, for tooling; undefined = not declared
  fn: EffectFn<ActorContext>;
}

type EmitOf<E> = E extends readonly AnyEventRef[] ? CreatedOf<E[number]> : InternalEvent;
type SendList<I extends readonly AnyEventRef[]> = readonly I[number][] | undefined;

export interface BuiltMaps<States extends readonly AnyStateRef[], ActorContext> {
  transitions: Record<string, Record<string, TransitionHandler<States, ActorContext>>>;
  /** Declared `to` state names per `[state][event]`; `Any` keys `onAny`. Static graph for tooling. */
  targets: Record<string, Record<string, string[]>>;
  effects: Record<string, Array<EffectEntry<ActorContext>>>;
}

type StateInput<S> = S extends AnyStateRef ? { name: S["name"]; payload: PayloadOf<S> } : never;

/** Handler may only return states listed in `to`; no `to` means it can only stay. */
type HandlerFn<
  Current extends AnyStateRef,
  To extends AnyStateRef,
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  E extends AnyEventRef,
> = (
  event: E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never,
  opts: {
    context: Context<ActorContext>;
    actor: AnyActor<ActorContext>;
    state: StateInput<Current>;
  },
) => TransitionResult<To, EventTypeOf<Outputs[number]>>;

interface HandlerOptions<
  Current extends AnyStateRef,
  To extends readonly AnyStateRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  E extends AnyEventRef,
> {
  event: E;
  to?: To;
  handler: HandlerFn<Current, NoInfer<To[number]>, Outputs, ActorContext, E>;
}

export interface ActorBuilder<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> {
  on<
    S extends States[number],
    E extends Inputs[number] | Internal[number],
    const To extends readonly States[number][] = readonly [],
  >(
    stateRef: S,
    options: HandlerOptions<S, To, Outputs, ActorContext, E>,
  ): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>;
  onAny<
    E extends Inputs[number] | Internal[number],
    const To extends readonly States[number][] = readonly [],
  >(
    options: HandlerOptions<States[number], To, Outputs, ActorContext, E>,
  ): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>;
  /** `sends`: internal events `fn` may emit; `emit` only accepts those. Omit for untyped `emit`. */
  effect<S extends States[number], const E extends SendList<Internal> = undefined>(
    stateRef: S,
    definition: { name: string; sends?: E; fn: EffectFn<ActorContext, PayloadOf<S>, EmitOf<E>> },
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
  const targets: BuiltMaps<States, ActorContext>["targets"] = {};
  const effects: BuiltMaps<States, ActorContext>["effects"] = {};

  function register(
    stateName: string,
    options: { event: AnyEventRef; to?: readonly AnyStateRef[]; handler: unknown },
  ): void {
    const eventType = options.event.type;
    (transitions[stateName] ??= {})[eventType] = parseTransitionHandler(options.handler);
    (targets[stateName] ??= {})[eventType] = (options.to ?? []).map((target) => target.name);
  }

  const self: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> = {
    on(stateRef, options): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
      register(stateRef.name, options);
      return self;
    },

    onAny(options): ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
      register("Any", options);
      return self;
    },

    effect(stateRef, { name, sends, fn }) {
      (effects[stateRef.name] ??= []).push({
        name,
        ...(sends && { sends: sends.map((sent) => sent.type) }),
        fn: parseEffectFn(fn),
      });
      return self;
    },

    build(): BuiltMaps<States, ActorContext> {
      return { transitions, targets, effects };
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
