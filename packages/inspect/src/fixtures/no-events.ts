import { Actor, machine, state } from "@mantaq/core";

/** Just showing. */
const shown = state("shown")();

export const noEvents = machine("noEvents", {
  create: ({ clock }) => {
    return Actor({ clock, inputs: [], states: [shown], initial: shown, setup: () => {} });
  },
});
