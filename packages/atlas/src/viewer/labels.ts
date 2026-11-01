import type { AtlasEdge, AtlasMachine } from "../schema.ts";

/** Names of the effects the state behind an effect edge runs on entry. */
export function effectNames(edge: AtlasEdge, machine: AtlasMachine): string[] {
  return machine.states.find((state) => state.id === edge.from)?.effects ?? [];
}

/** Text drawn on an edge: the event, or for an effect loop the effects it runs. */
export function edgeText(edge: AtlasEdge, machine: AtlasMachine): string {
  if (edge.kind !== "effect") return edge.event;
  const names = effectNames(edge, machine);
  return names.length === 0 ? "effect" : `runs ${names.join(", ")}`;
}
