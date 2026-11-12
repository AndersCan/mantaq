import { Actor, event, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")();

/** The person eats, and says what. */
const eat = event("eat")<{
  /**
   * What the person eats.
   * @example soup
   */
  food: string;
}>();

export function createMeal3() {
  return Actor({
    inputs: [eat],
    states: [hungry, full],
    initial: hungry,
    setup: (m) => {
      /** Food makes a hungry person full. */
      m.on(hungry, {
        event: eat,
        to: [full],
        handler: (event) => {
          if (event.payload.food === "") return {};
          return { state: full };
        },
      });
    },
  });
}
