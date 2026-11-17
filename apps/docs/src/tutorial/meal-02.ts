import { Actor, machine, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")();

export const meal2 = machine("meal2", {
  create: () => {
    return Actor({
      inputs: [],
      states: [hungry, full],
      initial: hungry,
      setup: () => {},
    });
  },
});
