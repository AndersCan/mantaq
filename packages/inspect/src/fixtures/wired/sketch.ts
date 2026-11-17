/** A machine only drawn: no app code creates it, and only its test does. */
import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const start = event("start")();

// Exported under another name than its id: not-run is matched by the id.
export const sketchDraft = machine("sketch", {
  create: ({ clock }) => {
    return Actor({
      inputs: [start],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: start, to: [idle], handler: () => ({ state: idle }) });
      },
    });
  },
});

export type SketchActor = ReturnType<typeof sketchDraft.create>;
