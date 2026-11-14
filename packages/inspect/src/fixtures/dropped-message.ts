/** A kitchen that tells a waiter a dish is ready; a waiter on a break has no handler for it. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { onOutput } from "@mantaq/sugar";

const open = state("open")();
const dishCooked = event("DISH_COOKED")();
const dishReady = event("DISH_READY")();
const dishServed = event("DISH_SERVED")();
const breakStarted = event("BREAK_STARTED")();

const serving = state("serving")();
const carryingDish = state("carryingDish")();
const onBreak = state("onBreak")();

export function createDroppedMessage({ clock = VirtualClock() }: { clock?: VirtualClock } = {}): {
  actor: AnyActor<unknown>;
  waiter: AnyActor<unknown>;
} {
  const waiter = Actor({
    inputs: [dishReady, dishServed, breakStarted],
    states: [serving, carryingDish, onBreak],
    initial: serving,
    clock,
    setup: (m) => {
      m.on(serving, {
        event: dishReady,
        to: [carryingDish],
        handler: () => ({ state: carryingDish }),
      });
      m.on(serving, { event: breakStarted, to: [onBreak], handler: () => ({ state: onBreak }) });
      m.on(carryingDish, { event: dishServed, to: [serving], handler: () => ({ state: serving }) });
    },
  });
  const kitchen = Actor({
    inputs: [dishCooked],
    outputs: [dishReady],
    states: [open],
    initial: open,
    clock,
    setup: (m) => {
      m.on(open, { event: dishCooked, handler: () => ({ emit: [dishReady.create()] }) });
    },
  });
  onOutput(kitchen, (out) => waiter.send(out as never));
  return { actor: kitchen, waiter };
}
