import { Actor, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")();

export function createMeal2() {
  return Actor({
    inputs: [],
    states: [hungry, full],
    initial: hungry,
    setup: () => {},
  });
}
