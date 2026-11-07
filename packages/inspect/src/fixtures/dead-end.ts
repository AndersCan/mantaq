import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** The actor waits for a request. */
const waitingForRequest = state("waitingForRequest")();
/** The actor waits for a reply and nothing can happen. */
const waitingForReply = state("waitingForReply")();
/** A reply was requested. */
const replyRequested = event("replyRequested")();

export function createDeadEndActor(clock: VirtualClock = VirtualClock()) {
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
}
