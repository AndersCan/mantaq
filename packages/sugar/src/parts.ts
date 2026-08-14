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

type InternalOf<M extends Machine> = M extends { internal: infer I extends readonly AnyEventRef[] }
  ? I
  : readonly [];
type OutputsOf<M extends Machine> = M extends { outputs: infer O extends readonly AnyEventRef[] }
  ? O
  : readonly [];
type ContextOf<M extends Machine> = M extends { context: infer C } ? C : Record<string, unknown>;

export type BuilderOf<M extends Machine> = ActorBuilder<
  M["states"],
  M["inputs"],
  InternalOf<M>,
  OutputsOf<M>,
  ContextOf<M>
>;

export type Fragment<M extends Machine> = (m: BuilderOf<M>) => void;

export function definePart<M extends Machine>(fn: (m: BuilderOf<M>) => void): Fragment<M> {
  return fn;
}

export function use<M extends Machine>(m: BuilderOf<M>, part: Fragment<M>): void {
  part(m);
}

type Part<
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
  parts: readonly Part<States, Inputs, Internal, Outputs, ActorContext>[],
) {
  return new Actor({
    ...base,
    setup: (m) => {
      for (const part of parts) part(m);
    },
  });
}
