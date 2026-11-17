/** Sends `a` and `b`; no listener lives here, tests write their own. */
import { Actor, event, machine, state } from "@mantaq/core";

const ready = state("ready")();

const chime = event("chime")();
const a = event("a")();
const b = event("b")();

export const duo = machine("duo", {
  create: ({ clock }) => {
    return Actor({
      inputs: [chime],
      outputs: [a, b],
      states: [ready],
      initial: ready,
      clock,
      setup: (m) => {
        m.on(ready, {
          event: chime,
          to: [ready],
          handler: () => ({ state: ready, emit: [a.create(), b.create()] }),
        });
      },
    });
  },
});
