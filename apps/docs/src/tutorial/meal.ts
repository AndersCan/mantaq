import { Actor, event, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")();

/** The person eats. */
const eat = event("eat")();

export function createMeal() {
  return Actor({
    inputs: [eat],
    states: [hungry, full],
    initial: hungry,
    setup: (m) => {
      /** Eating makes a hungry person full. */
      m.on(hungry, { event: eat, to: [full], handler: () => ({ state: full }) });
    },
  });
}
