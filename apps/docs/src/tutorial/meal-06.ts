import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

type MealContext = { plates: number };

/** The person wants food. */
const hungry = state("hungry")();
/** The person has eaten. */
const full = state("full")().final();

/** Someone puts one more plate on the table. */
const serve = event("serve")();
/** The person eats, and says what. */
const eat = event("eat")<{
  /**
   * What the person eats.
   * @example soup
   */
  food: string;
}>();

export function createMeal6(clock: Clock) {
  const initialContext: MealContext = { plates: 0 };
  return Actor({
    inputs: [serve, eat],
    states: [hungry, full],
    initial: hungry,
    clock,
    context: initialContext,
    setup: (m) => {
      /** One more plate is counted, and the person stays hungry. */
      m.on(hungry, {
        event: serve,
        to: [],
        handler: (_event, { context }) => {
          context.set({ plates: context.get().plates + 1 });
          return {};
        },
      });
      /** Food makes a hungry person full, once a plate is on the table. */
      m.on(hungry, {
        event: eat,
        to: [full],
        handler: (event, { context }) => {
          if (event.payload.food === "") return {};
          if (context.get().plates === 0) return {};
          return { state: full };
        },
      });
    },
  });
}
