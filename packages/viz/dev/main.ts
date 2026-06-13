import { Actor, VirtualClock, state, event } from "@mantaq/core";
import "../src/index.ts";
import type { MantaqViz } from "../src/components/mantaq-viz.ts";

const idling = state("idling")();
const working = state("working")();
const reviewing = state("reviewing")();
const failed = state("failed")();
const completed = state("completed")().final();

const START = event("START")();
const FINISH = event("FINISH")();
const APPROVE = event("APPROVE")();
const REJECT = event("REJECT")();
const RETRY = event("RETRY")();
const RESET = event("RESET")();
const WORK_TIMEOUT = event("WORK_TIMEOUT")();

const clock = new VirtualClock();

function createWorkflowActor() {
  return new Actor({
    inputs: [START, FINISH, APPROVE, REJECT, RETRY, RESET],
    outputs: [],
    internal: [WORK_TIMEOUT],
    states: [idling, working, reviewing, failed, completed],
    initial: idling,
    context: { attempts: 0, reviewer: "alice" },
    clock,
    effects: {
      working: [
        ({ clock, signal, emit }) => {
          clock.setTimeout(
            4000,
            () => {
              emit(WORK_TIMEOUT.create(undefined));
            },
            { signal, eventName: "WORK_TIMEOUT" },
          );
        },
      ],
    },
    transitions: {
      idling: { START: () => ({ state: working }) },
      working: {
        FINISH: () => ({ state: reviewing }),
        WORK_TIMEOUT: () => ({ state: failed }),
      },
      reviewing: {
        APPROVE: () => ({ state: completed }),
        REJECT: () => ({ state: failed }),
      },
      failed: { RETRY: () => ({ state: working }), RESET: () => ({ state: idling }) },
    },
  });
}

const actor = createWorkflowActor();

const viz = document.querySelector<MantaqViz>("mantaq-viz");
if (!viz) throw new Error("mantaq-viz element not found");

viz.sampleContexts = {
  default: { attempts: 0, reviewer: "alice" },
  retry: { attempts: 3, reviewer: "bob" },
};
viz.actor = actor;

Object.assign(globalThis, { actor, clock });
