import type { AnyActor, InternalEvent } from "@mantaq/core";

/**
 * Route an actor's emitted outputs to one or more handlers.
 *
 * `regions` auto-wire child outputs into the parent. ActorMap children do
 * not — this is the public wrapper for that wiring seam. One call in the
 * factory connects a child's declared outputs to a receiver — pass several
 * handlers to feed multiple receivers.
 */
export function onOutput(
  actor: AnyActor,
  ...handlers: [handler: (event: InternalEvent) => void]
): void {
  for (const handler of handlers) {
    actor.on("output", { fn: handler });
  }
}
