/** Takes `take` and `poke`; nothing here names the sender. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const waiting = state("waiting")();
const received = state("received")().final();

export const take = event("take")();
export const poke = event("poke")();

export function createReceiverActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [take, poke],
    states: [waiting, received],
    initial: waiting,
    clock,
    setup: (m) => {
      m.on(waiting, { event: take, to: [received], handler: () => ({ state: received }) });
      m.on(waiting, { event: poke, to: [received], handler: () => ({ state: received }) });
    },
  });
}

export const receiverActor = createReceiverActor();

export const receiver = { take: () => receiverActor.send(take.create()) };
