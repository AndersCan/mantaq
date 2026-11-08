/** A machine only drawn: no app code creates it, and only its test does. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const start = event("start")();

export function createSketchActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [start],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: start, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}

export type SketchActor = ReturnType<typeof createSketchActor>;
