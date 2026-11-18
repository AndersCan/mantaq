import { Actor, event, machine, state } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";

/** The kitchen's only state. */
const open = state("cooking")();
/** A dish is cooked: the kitchen tells the waiter. */
const dishCooked = event("DISH_COOKED")();
/** The kitchen's message to the waiter, which the waiter handles in no state. */
const dishReady = event("DISH_READY")();
/** The waiter goes on a break. */
const breakStarted = event("BREAK_STARTED")();
/** The waiter is back from the break. */
const breakEnded = event("BREAK_ENDED")();

/** Waiting for a dish. */
const serving = state("serving")();
/** Takes no dish. */
const onBreak = state("onBreak")();

/** A kitchen that tells a waiter a dish is ready; the waiter never handles it. */
export const cookMachine = machine("cook", {
  create: () => {
    const waiter = Actor({
      inputs: [dishReady, breakStarted, breakEnded],
      states: [serving, onBreak],
      initial: serving,
      setup: (m) => {
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
      setup: (m) => {
        /** A cooked dish becomes a DISH_READY for the waiter. */
        m.on(open, { event: dishCooked, handler: () => ({ emit: [dishReady.create()] }) });
      },
    });
    onOutput(kitchen, () => waiter.send(dishReady.create()));
    return { actor: kitchen, waiter };
  },
});
