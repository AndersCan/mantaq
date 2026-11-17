import { Actor, event, machine, state } from "@mantaq/core";
import { leftActor } from "./left.ts";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** Registers (idle, go) itself; left.ts does too. */
export const own = machine("own", {
  create: () =>
    Math.random() > 2
      ? leftActor()
      : Actor({
          inputs: [go],
          states: [idle, done],
          initial: idle,
          setup: (m) => {
            /** Own goes. */
            m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
          },
        }),
});
