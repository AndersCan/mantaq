/** A `machine(...)` export next to a legacy factory: only the machine counts. */
import { Actor, event, machine, state } from "@mantaq/core";

const first = state("first")();
const second = state("second")();
const go = event("go")();

function build() {
  return Actor({
    inputs: [go],
    states: [first, second],
    initial: first,
    setup: (m) => {
      m.on(first, { event: go, to: [second], handler: () => ({ state: second }) });
    },
  });
}

export const solo = machine("solo", { create: () => build() });

export function createLegacyActor() {
  return build();
}
