import type { Reader } from "./validate-read.ts";
import { report } from "./validate-read.ts";
import type { VizMachine } from "../schema.ts";

type Embeds = Map<string, string[]>;

/** The two ends of an embed path: from the embedded machine back to the one that embeds it. */
interface EmbedEnds {
  from: string;
  to: string;
}

function embedsOf(machines: ReadonlyArray<VizMachine>): Embeds {
  const embeds: Embeds = new Map();
  for (const machine of machines) {
    const targets = machine.states.flatMap((state) =>
      state.machine === undefined ? [] : [state.machine],
    );
    embeds.set(machine.id, [...(embeds.get(machine.id) ?? []), ...targets]);
  }
  return embeds;
}

/** A finished search: each machine's parent on the way back, and the machine it reached. */
interface Walk {
  parents: Map<string, string>;
  last: string;
}

function trail(walk: Walk): string[] {
  const { parents, last } = walk;
  const path = [last];
  let parent = parents.get(last);
  while (parent !== undefined) {
    path.unshift(parent);
    parent = parents.get(parent);
  }
  return path;
}

/** Shortest chain of embeds from `from` to `to`, both ends included; undefined when there is none. */
function embedPath(embeds: Embeds, ends: EmbedEnds): string[] | undefined {
  const parents = new Map<string, string>();
  const seen = new Set([ends.from]);
  const queue = [ends.from];
  for (const id of queue) {
    if (id === ends.to) return trail({ parents, last: id });
    for (const next of embeds.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parents.set(next, id);
      queue.push(next);
    }
  }
  return undefined;
}

function describeCycle(cycle: ReadonlyArray<string>): string {
  const first = JSON.stringify(cycle[0]);
  const chain = cycle.join(" > ");
  return `machine ${first} embeds itself: ${chain}`;
}

/**
 * A state's `machine` must name a machine in the same document, and no machine
 * may embed itself through a chain of embeds. Each reference on a cycle is reported.
 */
export function checkEmbeds(reader: Reader, machines: ReadonlyArray<VizMachine>): void {
  const ids = new Set(machines.map((machine) => machine.id));
  const embeds = embedsOf(machines);
  for (const [machineIndex, machine] of machines.entries()) {
    for (const [stateIndex, state] of machine.states.entries()) {
      if (state.machine === undefined) continue;
      const path = `$.machines[${machineIndex}].states[${stateIndex}].machine`;
      if (!ids.has(state.machine)) {
        report(reader, { path, message: `unknown machine ${JSON.stringify(state.machine)}` });
        continue;
      }
      const back = embedPath(embeds, { from: state.machine, to: machine.id });
      if (back !== undefined) {
        report(reader, { path, message: describeCycle([machine.id, ...back]) });
      }
    }
  }
}
