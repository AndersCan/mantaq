/** A `machine(...)` export whose name is not its id: the id is what the board, links and expectations use. */
import { Actor, event, machine, state } from "@mantaq/core";

const off = state("off")();
const on = state("on")();
const flip = event("flip")();

export const deskLamp = machine("lamp", {
  create: () =>
    Actor({
      inputs: [flip],
      states: [off, on],
      initial: off,
      setup: (m) => {
        m.on(off, { event: flip, to: [on], handler: () => ({ state: on }) });
      },
    }),
});

export const lampExpectations = { machine: "lamp", states: { on: { mustSee: [{}] } } };
