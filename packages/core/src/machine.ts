import type { AnyActor, Clock } from "./actor.ts";
import { RealClock } from "./real-clock.ts";

type MachineMade = AnyActor<unknown> | { actor: AnyActor<unknown> };

/** A named, typed way to build fresh actors. Made by `machine(id, { create })`. */
export interface Machine<
  Id extends string = string,
  Options extends object = {},
  Made extends MachineMade = MachineMade,
> {
  /** Name on the board, in links and in recorded runs. */
  readonly id: Id;
  /** A fresh actor (and the machines built with it) per call. `clock` is real time unless given. */
  create(options?: Options & { clock?: Clock }): Made;
}

// `never` when a create option other than clock is required, so tests and tools can always build it.
type EveryOptionHasADefault<Options extends object> = {} extends Options ? {} : never;

/**
 * Names a machine and builds fresh actors from `create`.
 * `create` always receives a `clock`: real time by default, a `VirtualClock` in tests and tools.
 * Every other option of `create` must be optional (give it a default).
 */
export function machine<
  const Id extends string,
  Made extends MachineMade,
  Options extends object = {},
>(
  id: Id,
  definition: { create: (options: Options & { clock: Clock }) => Made } & EveryOptionHasADefault<
    Omit<Options, "clock">
  >,
): Machine<Id, Omit<Options, "clock">, Made>;
export function machine(
  id: string,
  definition: { create(options: { clock: Clock }): MachineMade },
): Machine {
  return {
    id,
    create: (options = {}) =>
      definition.create({ ...options, clock: options.clock ?? RealClock() }),
  };
}
