import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** Left library: one worker that goes straight to done. */
export function leftActor() {
  return Actor({
    inputs: [go],
    states: [idle, done],
    initial: idle,
    setup: (m) => {
      /** Left goes. */
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
    },
  });
}
