/** Needs the project's Vite config: reads `import.meta.env.VITE_X` at load. */
/// <reference types="vite/client" />
import { Actor, event, machine, state } from "@mantaq/core";

const label: unknown = import.meta.env.VITE_X;
if (typeof label !== "string") throw new Error("VITE_X is not set");

const idle = state(label)();
const ping = event("ping")();

export const env = machine("env", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [ping],
      states: [idle],
      initial: idle,
      setup: (m) => {
        m.on(idle, { event: ping, handler: () => ({}) });
      },
    });
  },
});
