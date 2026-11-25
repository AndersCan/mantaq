import type { AnyActor, Machine } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { isActor } from "../fuzz/run.ts";
import { VirtualClock } from "@mantaq/core";

/** An actor a factory made, and the whole result when it was `{ actor, ... }`. */
export interface Created {
  actor: AnyActor<unknown>;
  made?: unknown;
}

/** The actor of a factory result, and the whole result when it is `{ actor, ... }`. */
export function createdOf(result: AnyActor<unknown> | { actor: AnyActor<unknown> }): Created {
  return isActor(result) ? { actor: result } : { actor: result.actor, made: result };
}

/** A fresh actor of `machine` on a VirtualClock of its own, or the message of what `create` threw. */
export function freshActor(machine: Machine): Either<string, Created> {
  const made = Either.from(() => machine.create({ clock: VirtualClock() }));
  if (Either.isLeft(made)) {
    const reason = made[0];
    return Either.left(reason instanceof Error ? reason.message : String(reason));
  }
  return Either.right(createdOf(made[1]));
}
