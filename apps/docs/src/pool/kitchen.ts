import { Actor, RealClock, event, state } from "@mantaq/core";
import type { Clock } from "@mantaq/core";
import { createPool, onOutput } from "@mantaq/sugar";

function wait(options: { clock: Clock; ms: number; signal: AbortSignal }): Promise<void> {
  const { clock, ms, signal } = options;
  return new Promise((resolve) => {
    clock.setTimeout(ms, { cb: resolve, signal });
  });
}

const takingOrders = state("takingOrders")();
const orderPlaced = event("ORDER_PLACED")<{ dish: string }>();
const cooksWanted = event("COOKS_WANTED")<{ count: number }>();

/** A kitchen that sends every order to a pool of two cooks, and can ask for more or fewer. Each dish takes one second. */
export function createKitchen({ clock = RealClock() }: { clock?: Clock } = {}) {
  const pool = createPool<string, "orders">({
    name: "orders",
    workers: 2,
    run: (_dishes, { signal }) => wait({ clock, ms: 1000, signal }),
    clock,
  });
  const kitchen = Actor({
    inputs: [orderPlaced, cooksWanted],
    outputs: [pool.events.ITEM_ARRIVED, pool.events.WORKERS_RESIZED],
    states: [takingOrders],
    initial: takingOrders,
    clock,
    setup: (m) => {
      m.on(takingOrders, {
        event: orderPlaced,
        handler: (placed) => ({
          emit: [pool.events.ITEM_ARRIVED.create({ item: placed.payload.dish })],
        }),
      });
      m.on(takingOrders, {
        event: cooksWanted,
        handler: (wanted) => ({
          emit: [pool.events.WORKERS_RESIZED.create({ count: wanted.payload.count })],
        }),
      });
    },
  });
  onOutput(kitchen, (out) => pool.actor.send(out as never));
  return { actor: kitchen, orders: pool.actor, cooks: pool.workers };
}
