import type { VizDocument, VizMachine } from "@mantaq/viz";

interface Chosen {
  machine: VizMachine;
}

/** The machine first, then each machine of the document that its states embed, and the ones those embed, once each. */
export function machineWithEmbeds(document: VizDocument, options: Chosen): VizMachine[] {
  const kept = [options.machine];
  const ids = new Set([options.machine.id]);
  for (const machine of kept) {
    for (const state of machine.states) {
      const embedded = document.machines.find((each) => each.id === state.machine);
      if (embedded === undefined || ids.has(embedded.id)) continue;
      ids.add(embedded.id);
      kept.push(embedded);
    }
  }
  return kept;
}
