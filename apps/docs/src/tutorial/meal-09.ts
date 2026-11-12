import { Actor, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

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
/** The food was on the stove too long. */
const overcooked = event("overcooked")();

/** The person wants a drink. */
const thirsty = state("thirsty")();
/** The person has had a drink. */
const quenched = state("quenched")().final();

/** The person drinks. */
const drink = event("drink")();

/** Stands in for your stove. Here the food is ready at once. */
async function cookMeal(): Promise<void> {}

export function createMeal9(clock: Clock) {
  /** Tracks thirst on its own, beside the meal. */
  const thirst = Actor({
    inputs: [drink],
    states: [thirsty, quenched],
    initial: thirsty,
    clock,
    setup: (m) => {
      /** A drink ends the thirst. */
      m.on(thirsty, { event: drink, to: [quenched], handler: () => ({ state: quenched }) });
    },
  });
  const initialContext: MealContext = { plates: 0 };
  return Actor({
    inputs: [serve, eat, cook],
    internal: [cooked, overcooked],
    states: [hungry, cooking, full],
    initial: hungry,
    clock,
    regions: { thirst },
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
      /** Gives the food 10 seconds on the stove. */
      m.effect(cooking, {
        name: "cookTimer",
        sends: [overcooked],
        fn: (input) => withTimeout(10_000, { input, event: () => overcooked.create() }),
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
      /** Burnt food goes in the bin, so no plate. */
      m.on(cooking, { event: overcooked, to: [hungry], handler: () => ({ state: hungry }) });
    },
  });
}
