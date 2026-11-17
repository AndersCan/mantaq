/** A handler that logs a console error, and one that throws in the page. */
import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const noisy = event("noisy")();
const crash = event("crash")();

export const odd = machine("odd", {
  create: ({ clock }) => {
    return Actor({
      inputs: [noisy, crash],
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
        m.on(idle, {
          event: crash,
          handler: () => {
            if (typeof document === "undefined") {
              return {};
            }
            setTimeout(() => {
              throw new Error("harness-crash");
            }, 0);
            return {};
          },
        });
      },
    });
  },
});
