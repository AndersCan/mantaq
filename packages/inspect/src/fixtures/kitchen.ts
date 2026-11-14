/** A kitchen that sends orders to a pool of two cooks: another machine returned next to the actor. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { createPool, onOutput } from "@mantaq/sugar";
import type { ActorMap } from "@mantaq/sugar";

function wait(options: { clock: VirtualClock; ms: number; signal: AbortSignal }): Promise<void> {
  const { clock, ms, signal } = options;
  return new Promise((resolve) => {
    clock.setTimeout(ms, { cb: resolve, signal });
  });
}

const takingOrders = state("takingOrders")();
const orderPlaced = event("ORDER_PLACED")<{ dish: string }>();

/** The kitchen and the pool's two parts, the shape a factory returns to draw them together. */
export function createKitchen({ clock = VirtualClock() }: { clock?: VirtualClock } = {}): {
  actor: AnyActor<unknown>;
  orders: AnyActor<unknown>;
  cooks: ActorMap;
} {
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
