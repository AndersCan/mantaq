import { Actor } from "@mantaq/core";
import type {
  ActorBuilder,
  ActorOptions,
  AnyActor,
  AnyEventRef,
  AnyStateRef,
  Clock,
  InitialState,
} from "@mantaq/core";

export interface ActorSpec {
  states: readonly AnyStateRef[];
  inputs: readonly AnyEventRef[];
  internal?: readonly AnyEventRef[];
  outputs?: readonly AnyEventRef[];
  context?: unknown;
  initial: AnyStateRef | { state: AnyStateRef; payload?: unknown };
  clock?: Clock;
  regions?: Record<string, AnyActor>;
  internalBudget?: number;
}

type NotUndef<T> = [Exclude<T, undefined>] extends [never] ? never : Exclude<T, undefined>;

type InternalOf<S extends ActorSpec> = "internal" extends keyof S
  ? [NotUndef<S["internal"]>] extends [never]
    ? readonly []
    : NotUndef<S["internal"]>
  : readonly [];
type OutputsOf<S extends ActorSpec> = "outputs" extends keyof S
  ? [NotUndef<S["outputs"]>] extends [never]
    ? readonly []
    : NotUndef<S["outputs"]>
  : readonly [];
type ContextOf<S extends ActorSpec> = "context" extends keyof S
  ? [NotUndef<S["context"]>] extends [never]
    ? Record<string, unknown>
    : NotUndef<S["context"]>
  : Record<string, unknown>;

export type BuilderOf<S extends ActorSpec> = ActorBuilder<
  S["states"],
  S["inputs"],
  InternalOf<S>,
  OutputsOf<S>,
  ContextOf<S>
>;

export type Fragment<S extends ActorSpec> = (builder: BuilderOf<S>) => void;

export function definePart<S extends ActorSpec = never>(
  part: (builder: BuilderOf<S>) => void,
): Fragment<S> {
  return part;
}

/** Apply one or more parts to a builder, in order. */
export function use<S extends ActorSpec>(
  builder: BuilderOf<S>,
  ...parts: [Fragment<S>, ...Fragment<S>[]]
): void {
  for (const part of parts) {
    part(builder);
  }
}

export type Part<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = (builder: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>) => void;

type SpecValue<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
  Initial,
> = {
  states: States;
  inputs: Inputs;
  internal?: Internal;
  outputs?: Outputs;
  context?: ActorContext;
  clock?: Clock;
  regions?: Record<string, AnyActor>;
  internalBudget?: number;
  initial: Initial;
};

/**
 * Construct the actor's static spec — states, inputs, internal/output events,
 * context, initial state, clock, regions and budget. State/event tuples and
 * the initial ref narrow to literals while the context stays mutable, so
 * `definePart` handlers read and write it with no `as` casts.
 */
export function actorSpec<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
  const Initial extends InitialState<States[number]> = InitialState<States[number]>,
>(
  spec: SpecValue<States, Inputs, Internal, Outputs, ActorContext, Initial>,
): SpecValue<States, Inputs, Internal, Outputs, ActorContext, Initial> {
  return spec;
}

/**
 * Build an actor whose setup applies every given part in order. Pass parts
 * as separate arguments — single part or many.
 */
export function withParts<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
>(
  base: Omit<ActorOptions<States, Inputs, Internal, Outputs, ActorContext>, "setup">,
  ...parts: Part<States, Inputs, Internal, Outputs, ActorContext>[]
) {
  return Actor({
    ...base,
    setup: (builder) => {
      for (const part of parts) part(builder);
    },
  });
}
