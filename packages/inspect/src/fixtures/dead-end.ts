import { Actor, event, machine, state } from "@mantaq/core";

/** The actor waits for a request. */
const waitingForRequest = state("waitingForRequest")();
/** The actor waits for a reply and nothing can happen. */
const waitingForReply = state("waitingForReply")();
/** A reply was requested. */
const replyRequested = event("replyRequested")();

export const deadEnd = machine("deadEnd", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [replyRequested],
      states: [waitingForRequest, waitingForReply],
      initial: waitingForRequest,
      setup: (m) => {
        m.on(waitingForRequest, {
          event: replyRequested,
          to: [waitingForReply],
          handler: () => ({ state: waitingForReply }),
        });
      },
    });
  },
});
