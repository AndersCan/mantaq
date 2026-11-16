/** `idle` takes an input `zap` and an internal `apply`: group order is not name order. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")().final();
const zap = event("zap")();
const apply = event("apply")();

export function createOffersOrder(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [zap],
    internal: [apply],
    states: [idle, done],
    initial: idle,
    clock,
    context: {},
    setup: (m) => {
      m.on(idle, { event: zap, to: [done], handler: () => ({ state: done }) });
      m.on(idle, { event: apply, to: [done], handler: () => ({ state: done }) });
    },
  });
}
