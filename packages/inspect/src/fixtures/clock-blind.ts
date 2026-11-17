import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";

/** The actor waits for a request. */
const waitingForRequest = state("waitingForRequest")();
/** The actor handles a request. */
const handlingRequest = state("handlingRequest")();
/** A request arrived. */
const requestArrived = event("requestArrived")();
/** The request was handled. */
const requestHandled = event("requestHandled")();

/** Builds its actor on a clock of its own instead of the one create() is given. */
export const clockBlind = machine("clockBlind", {
  create: () => {
    return Actor({
      clock: VirtualClock(),
      inputs: [requestArrived, requestHandled],
      states: [waitingForRequest, handlingRequest],
      initial: waitingForRequest,
      setup: (m) => {
        /** The request is handled now. */
        m.on(waitingForRequest, {
          event: requestArrived,
          to: [handlingRequest],
          handler: () => ({ state: handlingRequest }),
        });
        /** The actor waits for the next request. */
        m.on(handlingRequest, {
          event: requestHandled,
          to: [waitingForRequest],
          handler: () => ({ state: waitingForRequest }),
        });
      },
    });
  },
});
