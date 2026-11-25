import { actorMapOf, scopeOf } from "../schema.ts";
import type { Reader } from "./validate-read.ts";
import { report } from "./validate-read.ts";
import type { VizMachine } from "../schema.ts";

/** A machine of the document and its path, e.g. `$.machines[0]`. */
interface MachineAt {
  machine: VizMachine;
  path: string;
}

/** The first state that put a group in its scope. */
interface GroupHome {
  scope: string;
  index: number;
}

function placeOf(scope: string): string {
  return scope === "" ? "the root" : `region ${JSON.stringify(scope)}`;
}

function nameProblem(group: string): string | undefined {
  if (group === "") return "empty group name";
  if (group.includes(".")) return `group name ${JSON.stringify(group)} contains "."`;
  return undefined;
}

/**
 * Each group of a machine has a name without `.`, and all its states share one
 * region scope outside any actor map. Every issue is reported at the state's `group`.
 */
export function checkGroups(reader: Reader, options: MachineAt): void {
  const { machine, path } = options;
  const homes = new Map<string, GroupHome>();
  for (const [index, state] of machine.states.entries()) {
    const { group } = state;
    if (group === undefined) continue;
    const at = `${path}.states[${index}].group`;
    const problem = nameProblem(group);
    if (problem !== undefined) report(reader, { path: at, message: problem });
    const scope = scopeOf(state.id);
    const map = actorMapOf(state.id, machine);
    const name = JSON.stringify(group);
    if (map !== undefined) {
      const quotedMap = JSON.stringify(map);
      report(reader, { path: at, message: `group ${name} is in actor map ${quotedMap}` });
      continue;
    }
    const home = homes.get(group);
    if (home === undefined) {
      homes.set(group, { scope, index });
      continue;
    }
    if (home.scope === scope) continue;
    const here = placeOf(scope);
    const there = placeOf(home.scope);
    report(reader, {
      path: at,
      message: `group ${name} is in ${here}, but states[${home.index}] puts it in ${there}`,
    });
  }
}
