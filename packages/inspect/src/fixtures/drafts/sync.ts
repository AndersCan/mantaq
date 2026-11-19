import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const busy = state("busy")();
const go = event("go")();

export function syncActor() {
  return Actor({
    inputs: [go],
    internal: [],
    states: [idle, busy],
    initial: idle,
    setup: (m) => {
      /** The first design starts the work. */
      m.on(idle, { event: go, to: [busy], handler: () => ({ state: busy }) });
    },
  });
}
