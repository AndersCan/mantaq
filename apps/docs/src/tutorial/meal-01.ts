import { Actor, machine, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();

export const meal1 = machine("meal1", {
  create: () => {
    return Actor({
      inputs: [],
      states: [hungry],
      initial: hungry,
      setup: () => {},
    });
  },
});
