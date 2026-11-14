import { Actor, RealClock, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";

/** The kitchen's only state. */
const open = state("cooking")();
/** A dish is cooked: the kitchen tells the waiter. */
const dishCooked = event("DISH_COOKED")();
/** The kitchen's message to the waiter. */
const dishReady = event("DISH_READY")();
/** The waiter hands the dish over and is free again. */
const dishServed = event("DISH_SERVED")();
/** The waiter goes on a break. */
const breakStarted = event("BREAK_STARTED")();
/** The waiter is back from the break. */
const breakEnded = event("BREAK_ENDED")();

/** Waiting for a dish. */
const serving = state("serving")();
/** A dish is in hand. */
const carryingDish = state("carryingDish")();
/** Takes no dish: DISH_READY has no handler here. */
const onBreak = state("onBreak")();

/** A kitchen that tells a waiter a dish is ready. A waiter on a break has no handler for it, so the dish is dropped. */
export function createCook({ clock = RealClock() }: { clock?: Clock } = {}) {
  const waiter = Actor({
    inputs: [dishReady, dishServed, breakStarted, breakEnded],
    states: [serving, carryingDish, onBreak],
    initial: serving,
    clock,
    setup: (m) => {
      /** A dish arrives while serving: pick it up. */
      m.on(serving, {
        event: dishReady,
        to: [carryingDish],
        handler: () => ({ state: carryingDish }),
      });
      /** The dish is served. */
      m.on(carryingDish, { event: dishServed, to: [serving], handler: () => ({ state: serving }) });
      /** Only a waiter who is serving can start a break. */
      m.on(serving, { event: breakStarted, to: [onBreak], handler: () => ({ state: onBreak }) });
      /** The break is over. */
      m.on(onBreak, { event: breakEnded, to: [serving], handler: () => ({ state: serving }) });
    },
  });
  const kitchen = Actor({
    inputs: [dishCooked],
    outputs: [dishReady],
    states: [open],
    initial: open,
    clock,
    setup: (m) => {
      /** A cooked dish becomes a DISH_READY for the waiter. */
      m.on(open, { event: dishCooked, handler: () => ({ emit: [dishReady.create()] }) });
    },
  });
  onOutput(kitchen, (out) => waiter.send(out as never));
  return { actor: kitchen, waiter };
}
