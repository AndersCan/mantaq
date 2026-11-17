/** A machine whose port decides where `wake` goes, and an export whose id is not a literal. */
import { Actor, event, machine, state } from "@mantaq/core";

const sleeping = state("sleeping")();
const awake = state("awake")().final();
const wake = event("wake")();

export const gated = machine("gated", {
  create: ({ open = false }: { open?: boolean }) =>
    Actor({
      inputs: [wake],
      states: [sleeping, awake],
      initial: sleeping,
      setup: (m) => {
        m.on(sleeping, {
          event: wake,
          to: [sleeping, awake],
          handler: () => ({ state: open ? awake : sleeping }),
        });
      },
    }),
});

const dynamicId: string = String(Math.random());

/** Its id is not a literal, so it is not a machine export. */
export const loose = machine(dynamicId, {
  create: () =>
    Actor({
      inputs: [wake],
      states: [sleeping, awake],
      initial: sleeping,
      setup: (m) => {
        m.on(sleeping, { event: wake, to: [awake], handler: () => ({ state: awake }) });
      },
    }),
});
