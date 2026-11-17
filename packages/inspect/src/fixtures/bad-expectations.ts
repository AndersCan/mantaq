import { Actor, event, machine, state } from "@mantaq/core";

/** The actor waits for a request. */
const waitingForRequest = state("waitingForRequest")();
/** The actor handles a request. */
const handlingRequest = state("handlingRequest")();
/** A request arrived. */
const requestArrived = event("requestArrived")();
/** The request was handled. */
const requestHandled = event("requestHandled")();

export const badExpectations = machine("badExpectations", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [requestArrived, requestHandled],
      states: [waitingForRequest, handlingRequest],
      initial: waitingForRequest,
      setup: (m) => {
        m.on(waitingForRequest, {
          event: requestArrived,
          to: [handlingRequest],
          handler: () => ({ state: handlingRequest }),
        });
        m.on(handlingRequest, {
          event: requestHandled,
          to: [waitingForRequest],
          handler: () => ({ state: waitingForRequest }),
        });
      },
    });
  },
});

export const badExpectationsExpectations = {
  machine: "badExpectations",
  states: { handlingRequest: { neverSee: "none" } },
};
