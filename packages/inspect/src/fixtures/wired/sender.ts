/** Sends `handedOver` and `other`; the wiring in wire.ts listens to it. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const ready = state("ready")();
const done = state("done")().final();

const go = event("go")();
const handedOver = event("handedOver")();
const other = event("other")();

export function createSenderActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [go],
    outputs: [handedOver, other],
    states: [ready, done],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, {
        event: go,
        to: [done],
        handler: () => ({ state: done, emit: [handedOver.create()] }),
      });
    },
  });
}

export const senderActor = createSenderActor();
