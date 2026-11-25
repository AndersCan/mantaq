import type { VizDocument, VizMachine } from "@mantaq/viz";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";

/** One inspected file: the machines it exports and the ones they embed. */
interface Drawn {
  machines: ReadonlyArray<VizMachine>;
  embedded: ReadonlyArray<VizMachine>;
}

export interface ModulesDocument {
  document: VizDocument;
  /** Each reference the merge dropped, starting with the id of the machine that held it. */
  warnings: string[];
}

interface Merge {
  byId: ReadonlyMap<string, VizMachine>;
  open: Set<string>;
  done: Map<string, VizMachine>;
  warnings: string[];
}

/** The machine with each reference that closes a cycle in the merged document dropped. */
function visit(merge: Merge, machine: VizMachine): VizMachine {
  merge.open.add(machine.id);
  const states = [];
  let dropped = 0;
  for (const state of machine.states) {
    const target = state.machine === undefined ? undefined : merge.byId.get(state.machine);
    if (target === undefined) {
      states.push(state);
      continue;
    }
    if (merge.open.has(target.id)) {
      const copy = { ...state };
      delete copy.machine;
      delete copy.forward;
      states.push(copy);
      dropped += 1;
      merge.warnings.push(
        `${machine.id}: ${state.id} embeds ${target.id}, not drawn: that is a cycle: ${target.id} embeds this machine, directly or through others`,
      );
      continue;
    }
    if (!merge.done.has(target.id)) merge.done.set(target.id, visit(merge, target));
    states.push(state);
  }
  merge.open.delete(machine.id);
  return dropped === 0 ? machine : { ...machine, states };
}

/**
 * One document of inspected files: their machines in order, then each machine they embed that
 * no file exports, once per id. Each file breaks its own cycles; a cycle through machines of
 * two files is broken here, so the document validates.
 */
export function modulesDocument(modules: ReadonlyArray<Drawn>): ModulesDocument {
  const order: VizMachine[] = [];
  const byId = new Map<string, VizMachine>();
  for (const module of modules) {
    for (const machine of module.machines) {
      order.push(machine);
      if (!byId.has(machine.id)) byId.set(machine.id, machine);
    }
  }
  for (const module of modules) {
    for (const machine of module.embedded) {
      if (byId.has(machine.id)) continue;
      order.push(machine);
      byId.set(machine.id, machine);
    }
  }
  const merge: Merge = { byId, open: new Set(), done: new Map(), warnings: [] };
  const machines = [];
  for (const machine of order) {
    const first = byId.get(machine.id) === machine;
    const drawn = (first ? merge.done.get(machine.id) : undefined) ?? visit(merge, machine);
    if (first) merge.done.set(machine.id, drawn);
    machines.push(drawn);
  }
  return { document: { schemaVersion: VIZ_SCHEMA_VERSION, machines }, warnings: merge.warnings };
}
