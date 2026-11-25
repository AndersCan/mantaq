import type { VizDocument, VizMachine } from "@mantaq/viz";
import type { InspectedModule } from "../inspect.ts";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";

type Drawn = Pick<InspectedModule, "machines" | "embedded">;

/**
 * One document of inspected files: their machines in order, then each machine they embed that
 * no file exports, once per id. Every state's `machine` then names a machine in the document.
 */
export function modulesDocument(modules: ReadonlyArray<Drawn>): VizDocument {
  const machines: VizMachine[] = [];
  const ids = new Set<string>();
  for (const module of modules) {
    for (const machine of module.machines) {
      machines.push(machine);
      ids.add(machine.id);
    }
  }
  for (const module of modules) {
    for (const machine of module.embedded) {
      if (ids.has(machine.id)) continue;
      machines.push(machine);
      ids.add(machine.id);
    }
  }
  return { schemaVersion: VIZ_SCHEMA_VERSION, machines };
}
