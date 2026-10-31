import { isAnyState } from "./schema.ts";
import type { AtlasMachine } from "./schema.ts";

export interface RoutingWarning {
  machine: string;
  event: string;
  message: string;
}

/**
 * `onAny` handlers that pick their target from the current state. Drawn from
 * `*`, they claim every declared target from every state; per-state `m.on`
 * registrations would draw the exact source/target pairs.
 */
export function routingWarnings(machine: AtlasMachine): RoutingWarning[] {
  const events = new Set(
    machine.edges
      .filter(
        (edge) =>
          isAnyState(edge.from) &&
          edge.explanation?.status === "analyzed" &&
          edge.explanation.readsActorState,
      )
      .map((edge) => edge.event),
  );
  return [...events].sort().map((event) => ({
    machine: machine.id,
    event,
    message: `onAny(${event}) reads actor state to pick its target, so the diagram cannot tell which state leads where. Register m.on per state instead.`,
  }));
}
