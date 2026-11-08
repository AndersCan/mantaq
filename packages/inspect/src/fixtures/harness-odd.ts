/** A handler that logs a console error. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const noisy = event("noisy")();

export function createOddActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [noisy],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, {
        event: noisy,
        handler: () => {
          console.error("harness-noise");
          return {};
        },
      });
    },
  });
}
