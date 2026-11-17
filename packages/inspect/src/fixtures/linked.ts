/**
 * Two machines that connect by event name: the sender declares `handedOver`
 * as an output, the receiver takes it in as an input.
 */
import { Actor, event, machine, state } from "@mantaq/core";

/** Ready to send. */
const ready = state("ready")();
/** The sender is finished. */
const done = state("done")().final();
/** Waiting for the message. */
const waiting = state("waiting")();
/** The message arrived. */
const received = state("received")().final();

/** The message was sent. */
const send = event("send")();
/** The message was handed to the receiver. */
const handedOver = event("handedOver")();

export const sender = machine("sender", {
  create: ({ clock }) => {
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
  },
});

export const receiver = machine("receiver", {
  create: ({ clock }) => {
    return Actor({
      inputs: [handedOver],
      states: [waiting, received],
      initial: waiting,
      clock,
      setup: (m) => {
        m.on(waiting, { event: handedOver, to: [received], handler: () => ({ state: received }) });
      },
    });
  },
});
