import { isAnyState, scopeOf } from "./schema.ts";
import type { VizMachine } from "./schema.ts";

/** One part of a machine: the root, a region, or an actor map (one child stands for all). */
export interface SystemPart {
  /** "" = the root. Otherwise the region path or the map name. */
  id: string;
  kind: "root" | "region" | "map";
  label: string;
  /** The part this one sits inside on the board: it talks only to that part, which has more states. null = on the board by itself. */
  within: string | null;
  /** True when no arrow joins this part to another part: the board lists it apart. */
  alone: boolean;
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

/** An event that enters a part from outside the machine: handled there, brought by no link. */
export interface SystemEntry {
  to: string;
  event: string;
}

export interface MachineSystem {
  parts: SystemPart[];
  links: SystemLink[];
  /** Sorted by part, then event. Actor maps have none. */
  entries: SystemEntry[];
}

function partsOf(machine: VizMachine): SystemPart[] {
  return [
    { id: "", kind: "root", label: machine.id, within: null, alone: false },
    ...machine.regions.map((id): SystemPart => ({
      id,
      kind: machine.maps.includes(id) ? "map" : "region",
      label: id,
      within: null,
      alone: false,
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
  return {
    parts: arrange(machine, parts, links),
    links,
    entries: entriesOf(machine, parts, links),
  };
}

/**
 * Fills `within` and `alone` from the arrows. A part with no partner is alone.
 * A part whose only partner has more states sits within it, so a small part
 * is drawn inside the part it talks to. Entries and ends leaving the machine
 * make no partner.
 */
function arrange(
  machine: VizMachine,
  parts: ReadonlyArray<SystemPart>,
  links: ReadonlyArray<SystemLink>,
): SystemPart[] {
  return parts.map((part) => {
    const partners = new Set(
      links.flatMap((link) => {
        if (link.to === null) return [];
        if (link.from === part.id) return [link.to];
        return link.to === part.id ? [link.from] : [];
      }),
    );
    const [only] = partners;
    const bigger =
      only !== undefined &&
      partners.size === 1 &&
      statesOf(machine, only).length > statesOf(machine, part.id).length;
    return { ...part, alone: partners.size === 0, within: bigger ? only : null };
  });
}

/** Non-internal events a root or region handles that no link brings to it. */
function entriesOf(
  machine: VizMachine,
  parts: ReadonlyArray<SystemPart>,
  links: ReadonlyArray<SystemLink>,
): SystemEntry[] {
  const internal = new Set(
    machine.events.filter((event) => event.internal).map((event) => event.id),
  );
  return parts
    .filter((part) => part.kind !== "map")
    .flatMap((part) => {
      const events = machine.edges
        .filter(
          (edge) =>
            (edge.kind === "transition" || edge.kind === "stay") &&
            scopeOf(edge.from) === part.id &&
            !internal.has(edge.event) &&
            !links.some((link) => link.to === part.id && link.event === edge.event),
        )
        .map((edge) => edge.event);
      return [...new Set(events)].sort().map((event): SystemEntry => ({ to: part.id, event }));
    });
}

/** True when some arrow goes from one part to another, so the machine has a system to draw. */
export function linksInside(system: MachineSystem): boolean {
  return system.links.some((link) => link.to !== null);
}
