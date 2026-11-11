import { isAnyState, scopeOf } from "./schema.ts";
import type { VizMachine } from "./schema.ts";

/** One part of a machine: the root, a region, or an actor map (one child stands for all). */
export interface SystemPart {
  /** "" = the root. Otherwise the region path or the map name. */
  id: string;
  kind: "root" | "region" | "map";
  label: string;
}

/** One declared output of a part, and the part that takes it. */
export interface SystemLink {
  from: string;
  /** null = no part takes it: it leaves the machine. */
  to: string | null;
  event: string;
  /** Full state ids of `to` that handle the event; every state when a `*` handler covers it. [] when `to` is null. */
  handledIn: string[];
  /** Edge ids in `from` whose emits include the event. [] when the edges do not say. */
  senders: string[];
}

export interface MachineSystem {
  parts: SystemPart[];
  links: SystemLink[];
}

function partsOf(machine: VizMachine): SystemPart[] {
  return [
    { id: "", kind: "root", label: machine.id },
    ...machine.regions.map((id): SystemPart => ({
      id,
      kind: machine.maps.includes(id) ? "map" : "region",
      label: id,
    })),
  ];
}

/** Non-`*` states of a part, in the document's order. */
function statesOf(machine: VizMachine, part: string): string[] {
  return machine.states.filter((state) => (state.region ?? "") === part).map((state) => state.id);
}

/** The states of `part` that take `event`: those with an edge for it, or all of them under a `*` edge. */
function handledIn(machine: VizMachine, part: string, event: string): string[] {
  const edges = machine.edges.filter(
    (edge) =>
      edge.event === event &&
      (edge.kind === "transition" || edge.kind === "stay") &&
      scopeOf(edge.from) === part,
  );
  const states = statesOf(machine, part);
  if (edges.some((edge) => isAnyState(edge.from))) return states;
  return states.filter((id) => edges.some((edge) => edge.from === id));
}

/** The part a region's output goes to: the nearest enclosing part, else the root. */
function parentOf(parts: ReadonlyArray<SystemPart>, id: string): string {
  const parent = scopeOf(id);
  return parts.some((part) => part.id === parent) ? parent : "";
}

/**
 * The parts of one machine and the arrows between them: a part's declared
 * output matched to another part's handled input. A region's output goes only
 * to its parent. A root or map output goes to every other part that takes it.
 */
export function systemOf(machine: VizMachine): MachineSystem {
  const parts = partsOf(machine);
  const links = parts.flatMap((part) => {
    const outputs = part.id === "" ? machine.outputs : (machine.partOutputs[part.id] ?? []);
    return outputs.flatMap((event): SystemLink[] => {
      const senders = machine.edges
        .filter((edge) => scopeOf(edge.from) === part.id && edge.emits.includes(event))
        .map((edge) => edge.id);
      const candidates =
        part.kind === "region"
          ? [parentOf(parts, part.id)]
          : parts.filter((other) => other.id !== part.id).map((other) => other.id);
      const takers = candidates
        .map((to) => ({ to, handled: handledIn(machine, to, event) }))
        .filter((taker) => taker.handled.length > 0);
      if (takers.length === 0) return [{ from: part.id, to: null, event, handledIn: [], senders }];
      return takers.map((taker): SystemLink => ({
        from: part.id,
        to: taker.to,
        event,
        handledIn: taker.handled,
        senders,
      }));
    });
  });
  return { parts, links };
}

/** True when some arrow goes from one part to another, so the machine has a system to draw. */
export function linksInside(system: MachineSystem): boolean {
  return system.links.some((link) => link.to !== null);
}
