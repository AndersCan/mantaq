/** Needs the project's Vite config: reads `import.meta.env.VITE_X` at load. */
/// <reference types="vite/client" />
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const label: unknown = import.meta.env.VITE_X;
if (typeof label !== "string") throw new Error("VITE_X is not set");

const idle = state(label)();
const ping = event("ping")();

export function createEnvActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [ping],
    states: [idle],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: ping, handler: () => ({}) });
    },
  });
}
