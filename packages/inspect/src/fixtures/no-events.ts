import { Actor, VirtualClock, state } from "@mantaq/core";

/** Just showing. */
const shown = state("shown")();

export function createNoEventsActor(clock: VirtualClock = VirtualClock()) {
  return Actor({ clock, inputs: [], states: [shown], initial: shown, setup: () => {} });
}
