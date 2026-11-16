import type { VizLiveState, VizMachine } from "../schema.ts";
import { compareKeys } from "./compartments.ts";

/** One map's children counted by state, in the machine's state order, zeros dropped. */
export function countsOf(
  machine: VizMachine,
  live: VizLiveState,
  map: string,
): { total: number; items: Array<{ state: string; label: string; keys: string[] }> } {
  const children = live.children.filter((child) => child.map === map);
  const items = machine.states
    .filter((state) => state.region === map)
    .map((state) => ({
      state: state.id,
      label: state.label,
      keys: children
        .filter((child) => child.state === state.id)
        .map((child) => child.key)
        .sort(compareKeys),
    }))
    .filter((item) => item.keys.length > 0);
  return { total: children.length, items };
}

/** The live title of a map's frame: "workers: 1 free, 1 working", or "workers: none". */
export function countTitle(machine: VizMachine, live: VizLiveState, map: string): string {
  const { items } = countsOf(machine, live, map);
  if (items.length === 0) return `${map}: none`;
  return `${map}: ${items.map((item) => `${item.keys.length} ${item.label}`).join(", ")}`;
}

/** The lowest key of `map` whose child is in `stateId` or a state nested under it; undefined when none is. */
export function childIn(live: VizLiveState, map: string, stateId: string): string | undefined {
  return live.children
    .filter(
      (child) =>
        child.map === map && (child.state === stateId || child.state.startsWith(`${stateId}.`)),
    )
    .map((child) => child.key)
    .sort(compareKeys)[0];
}
