/** Sends `heard` and `unheard`; only `heard` is checked by a listener. */
import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";

const ready = state("ready")();

const chime = event("chime")();
const heard = event("heard")();
const unheard = event("unheard")();

export const quiet = machine("quiet", {
  create: ({ clock }) => {
    return Actor({
      inputs: [chime],
      outputs: [heard, unheard],
      states: [ready],
      initial: ready,
      clock,
      setup: (m) => {
        m.on(ready, {
          event: chime,
          to: [ready],
          handler: () => ({ state: ready, emit: [heard.create(), unheard.create()] }),
        });
      },
    });
  },
});

export const quietActor = quiet.create({ clock: VirtualClock() });

function note(): void {}

quietActor.on("output", {
  fn: (e) => {
    if (e.type === heard.type) note();
  },
});
