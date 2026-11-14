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

/** A kitchen that sends every order to a pool of two cooks. Each dish takes one second. */
export function createKitchen({ clock = RealClock() }: { clock?: Clock } = {}) {
  const pool = createPool<string, "orders">({
    name: "orders",
    workers: 2,
    run: (_dishes, { signal }) => wait({ clock, ms: 1000, signal }),
    clock,
  });
  const kitchen = Actor({
    inputs: [orderPlaced],
    outputs: [pool.events.ITEM_ARRIVED],
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
    },
  });
  onOutput(kitchen, (out) => pool.actor.send(out as never));
  return { actor: kitchen, orders: pool.actor, cooks: pool.workers };
}
