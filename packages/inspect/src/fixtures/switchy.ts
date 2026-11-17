/** A handler whose returns sit inside a switch: outside what the AST pass understands. */
import { Actor, event, machine, state } from "@mantaq/core";

const off = state("off")();
const low = state("low")();
const high = state("high")();
const dial = event("dial")<{ level: number }>();

export const switchy = machine("switchy", {
  create: ({ clock }) => {
    return Actor({
      inputs: [dial],
      states: [off, low, high],
      initial: off,
      clock,
      setup: (m) => {
        m.on(off, {
          event: dial,
          to: [low, high],
          handler: (event) => {
            switch (event.payload.level) {
              case 1:
                return { state: low };
              case 2:
                return { state: high };
              default:
                return {};
            }
          },
        });
      },
    });
  },
});
