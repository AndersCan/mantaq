import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** A helper the root calls for its name; the root never runs xActor. */
export function label(): string {
  return "x";
}

export function options(): { retries: number } {
  return { retries: 3 };
}

export function xActor() {
  return Actor({
    inputs: [go],
    internal: [],
    states: [idle, done],
    initial: idle,
    setup: (m) => {
      /** X finishes at once. */
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
    },
  });
}
