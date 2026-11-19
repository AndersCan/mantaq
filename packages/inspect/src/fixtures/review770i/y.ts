import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const busy = state("busy")();
const go = event("go")();

export function yActor() {
  return Actor({
    inputs: [go],
    internal: [],
    states: [idle, busy],
    initial: idle,
    setup: (m) => {
      /** Y starts the work. */
      m.on(idle, { event: go, to: [busy], handler: () => ({ state: busy }) });
    },
  });
}
