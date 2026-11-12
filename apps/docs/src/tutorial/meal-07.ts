import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";

type MealContext = { plates: number };

/** The person wants food. */
const hungry = state("hungry")();
/** The food is on the stove. */
const cooking = state("cooking")();
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
/** The person puts food on the stove. */
export const cook = event("cook")();
/** The food is ready. */
const cooked = event("cooked")();

/** Stands in for your stove. Here the food is ready at once. */
async function cookMeal(): Promise<void> {}

export function createMeal7(clock: Clock) {
  const initialContext: MealContext = { plates: 0 };
  return Actor({
    inputs: [serve, eat, cook],
    internal: [cooked],
    states: [hungry, cooking, full],
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
      /** The food goes on the stove. */
      m.on(hungry, { event: cook, to: [cooking], handler: () => ({ state: cooking }) });
      /** Cooks the food and says when it is ready. */
      m.effect(cooking, {
        name: "cookMeal",
        sends: [cooked],
        fn: ({ signal, emit }) => {
          cookMeal().then(() => {
            if (signal.aborted) return;
            emit(cooked.create());
          });
        },
      });
      /** The food is ready: one more plate on the table. */
      m.on(cooking, {
        event: cooked,
        to: [hungry],
        handler: (_event, { context }) => {
          context.set({ plates: context.get().plates + 1 });
          return { state: hungry };
        },
      });
    },
  });
}
