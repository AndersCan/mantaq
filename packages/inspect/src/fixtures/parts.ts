import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const busy = state("busy")();
const go = event("go")();

function worker(clock: Parameters<Parameters<typeof machine>[1]["create"]>[0]["clock"]) {
  return Actor({
    clock,
    inputs: [go],
    states: [idle, busy],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [busy], handler: () => ({ state: busy }) });
      m.on(busy, { event: go, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}

/** An actor with two more actors beside it: three machines, drawn as boxes. */
export const parts = machine("parts", {
  create: ({ clock }) => ({ actor: worker(clock), left: worker(clock), right: worker(clock) }),
});
