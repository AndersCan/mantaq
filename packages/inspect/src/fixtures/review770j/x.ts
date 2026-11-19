import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** Settings the root reads a title from; the root never runs xActor. */
export const settings = {
  title(): string {
    return "x";
  },
};

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
