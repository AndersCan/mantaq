/**
 * Two machines that connect by event name: the sender declares `handedOver`
 * as an output, the receiver takes it in as an input.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const ready = state("ready")();
const done = state("done")().final();
const waiting = state("waiting")();
const received = state("received")().final();

const send = event("send")();
const handedOver = event("handedOver")();

export function createSenderActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [send],
    outputs: [handedOver],
    states: [ready, done],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, {
        event: send,
        to: [done],
        handler: () => ({ state: done, emit: [handedOver.create()] }),
      });
    },
  });
}

export function createReceiverActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [handedOver],
    states: [waiting, received],
    initial: waiting,
    clock,
    setup: (m) => {
      m.on(waiting, { event: handedOver, to: [received], handler: () => ({ state: received }) });
    },
  });
}
