import { Actor } from "@mantaq/core";
import type {
  ActorBuilder,
  ActorOptions,
  AnyActor,
  AnyEventRef,
  AnyStateRef,
  Clock,
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

export type Fragment<S extends ActorSpec> = (m: BuilderOf<S>) => void;

export function definePart<S extends ActorSpec = never>(
  fn: (m: BuilderOf<S>) => void,
): Fragment<S> {
  return fn;
}

export function use<S extends ActorSpec>(m: BuilderOf<S>, part: Fragment<S>): void {
  part(m);
}

export type Part<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = (m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>) => void;

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
 * the initial ref narrow to literals; the context stays mutable, so
 * `definePart` handlers read and write it with no `as` casts.
 */
export function actorSpec<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
  const Initial extends AnyStateRef | { state: AnyStateRef; payload?: unknown } = AnyStateRef,
>(
  spec: SpecValue<States, Inputs, Internal, Outputs, ActorContext, Initial>,
): SpecValue<States, Inputs, Internal, Outputs, ActorContext, Initial> {
  return spec;
}

export function withParts<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
>(
  base: Omit<ActorOptions<States, Inputs, Internal, Outputs, ActorContext>, "setup">,
  parts:
    | Part<States, Inputs, Internal, Outputs, ActorContext>
    | readonly Part<States, Inputs, Internal, Outputs, ActorContext>[],
) {
  const list: readonly Part<States, Inputs, Internal, Outputs, ActorContext>[] = Array.isArray(
    parts,
  )
    ? parts
    : [parts];
  return new Actor({
    ...base,
    setup: (m) => {
      for (const part of list) part(m);
    },
  });
}
