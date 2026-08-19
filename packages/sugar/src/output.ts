import type { AnyActor, InternalEvent } from "@mantaq/core";

/**
 * Route an actor's emitted outputs to a handler.
 *
 * `regions` auto-wire child outputs into the parent. ActorMap children do
 * not — this is the public wrapper for that wiring seam. One call in the
 * factory connects a child's declared outputs to a receiver.
 */
export function onOutput(actor: AnyActor, handler: (event: InternalEvent) => void): void {
  actor.on("output", handler);
}
