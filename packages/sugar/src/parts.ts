import { Actor } from "@mantaq/core";
import type {
  ActorBuilder,
  ActorOptions,
  AnyActor,
  AnyEventRef,
  AnyStateRef,
  Clock,
} from "@mantaq/core";

export interface Machine {
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

type InternalOf<M extends Machine> = "internal" extends keyof M
  ? [Exclude<M["internal"], undefined | null>] extends [never]
    ? readonly []
    : Exclude<M["internal"], undefined | null>
  : readonly [];
type OutputsOf<M extends Machine> = "outputs" extends keyof M
  ? [Exclude<M["outputs"], undefined | null>] extends [never]
    ? readonly []
    : Exclude<M["outputs"], undefined | null>
  : readonly [];
type ContextOf<M extends Machine> = "context" extends keyof M
  ? [Exclude<M["context"], undefined | null>] extends [never]
    ? Record<string, unknown>
    : Exclude<M["context"], undefined | null>
  : Record<string, unknown>;

export type BuilderOf<M extends Machine> = ActorBuilder<
  M["states"],
  M["inputs"],
  InternalOf<M>,
  OutputsOf<M>,
  ContextOf<M>
>;

export type Fragment<M extends Machine> = (m: BuilderOf<M>) => void;

export function definePart<M extends Machine = never>(fn: (m: BuilderOf<M>) => void): Fragment<M> {
  return fn;
}

export function use<M extends Machine>(m: BuilderOf<M>, part: Fragment<M>): void {
  part(m);
}

export type Part<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = (m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>) => void;

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
