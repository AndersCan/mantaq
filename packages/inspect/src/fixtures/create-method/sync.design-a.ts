import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const busy = state("busy")();
const go = event("go")();

function syncActor() {
  return Actor({
    inputs: [go],
    internal: [],
    states: [idle, busy],
    initial: idle,
    setup: (m) => {
      /** The draft starts the work. */
      m.on(idle, { event: go, to: [busy], handler: () => ({ state: busy }) });
    },
  });
}

/** The sync part, as justus exports it. */
export const syncMachine = machine("sync", { create: () => syncActor() });
