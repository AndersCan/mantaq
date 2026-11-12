import { Actor, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();

export function createMeal1() {
  return Actor({
    inputs: [],
    states: [hungry],
    initial: hungry,
    setup: () => {},
  });
}
