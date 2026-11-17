import { Actor, event, machine, state } from "@mantaq/core";

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")().final();

/** The person eats, and says what. */
const eat = event("eat")<{
  /**
   * What the person eats.
   * @example soup
   */
  food: string;
}>();

export const meal4 = machine("meal4", {
  create: () => {
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
  },
});
