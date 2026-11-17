/** Takes `take`, `poke` and `checked`; nothing here names the sender. */
import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";

const waiting = state("waiting")();
const checking = state("checking")();
const received = state("received")().final();

export const take = event("take")();
export const poke = event("poke")();
export const checked = event("checked")();

export const receiverMachine = machine("receiver", {
  create: ({ clock }) => {
    return Actor({
      inputs: [take, poke, checked],
      states: [waiting, checking, received],
      initial: waiting,
      clock,
      setup: (m) => {
        m.on(waiting, { event: take, to: [received], handler: () => ({ state: received }) });
        m.on(waiting, { event: poke, to: [checking], handler: () => ({ state: checking }) });
        m.on(checking, { event: checked, to: [received], handler: () => ({ state: received }) });
      },
    });
  },
});

export const receiverActor = receiverMachine.create({ clock: VirtualClock() });

export const receiver = { take: () => receiverActor.send(take.create()) };
