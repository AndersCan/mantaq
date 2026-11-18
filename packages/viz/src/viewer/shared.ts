import { isAnyState, scopeOf } from "../schema.ts";
import type { VizEdge, VizMachine } from "../schema.ts";
import { localName } from "./compartments.ts";
import { edgeLines } from "./labels.ts";

/** Fewest sibling states that take an event alike before it is drawn once. */
const SHARE_FROM = 3;
const ANY_LABEL = "any state";

interface SharedNode {
  id: string;
  scope: string;
  states: string[];
  label: string;
}

export interface SharedArrow {
  id: string;
  node: string;
  event: string;
  /** The real edge each source state has, in source order. */
  members: VizEdge[];
  /** What is drawn: the first member, from the node. */
  drawn: VizEdge;
}

export interface Shared {
  edges: VizEdge[];
  nodes: SharedNode[];
  arrows: SharedArrow[];
}

/** A node made here, not an `onAny` one: `region.*3`. */
export function isSharedNode(id: string): boolean {
  return /(^|\.)\*\d+$/.test(id);
}

interface Entry {
  key: string;
  edge: VizEdge;
}

function entriesOf(edges: ReadonlyArray<VizEdge>): Entry[] {
  return edges
    .map((edge) => ({ key: [edge.to, ...edgeLines(edge)].join("\n"), edge }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

interface Group {
  scope: string;
  event: string;
  sources: string[];
  entries: Entry[][];
}

function groupsOf(machine: VizMachine): Group[] {
  const bySource = new Map<string, VizEdge[]>();
  for (const edge of machine.edges) {
    if (edge.kind !== "transition" || edge.to === null || isAnyState(edge.from)) continue;
    const key = `${edge.from}\u0000${edge.event}`;
    bySource.set(key, [...(bySource.get(key) ?? []), edge]);
  }
  const groups = new Map<string, Group>();
  for (const state of machine.states) {
    for (const [key, edges] of bySource) {
      const [from, event = ""] = key.split("\u0000");
      if (from !== state.id) continue;
      const entries = entriesOf(edges);
      const scope = scopeOf(state.id);
      const id = [scope, event, ...entries.map((entry) => entry.key)].join("\u0001");
      const group = groups.get(id) ?? { scope, event, sources: [], entries: [] };
      group.sources.push(state.id);
      group.entries.push(entries);
      groups.set(id, group);
    }
  }
  return [...groups.values()].filter((group) => group.sources.length >= SHARE_FROM);
}

function labelOf(states: ReadonlyArray<string>): string {
  const names = states.map(localName);
  const more = names.length > 3 ? ` +${names.length - 3} more` : "";
  return `${names.slice(0, 3).join(", ")}${more}`;
}

/** The edges to draw: arrows several sibling states take alike are replaced by one from a shared node. */
export function shareArrows(machine: VizMachine): Shared {
  const order = new Map(machine.states.map((state, index) => [state.id, index]));
  const groups = groupsOf(machine);
  const nodes: SharedNode[] = [];
  const arrows: SharedArrow[] = [];
  const sets = new Map<string, SharedNode>();
  const counts = new Map<string, number>();
  const first = (group: Group): number => order.get(group.sources[0] ?? "") ?? 0;
  const ranked = [...groups].sort(
    (a, b) =>
      first(a) - first(b) ||
      b.sources.length - a.sources.length ||
      a.sources.join(",").localeCompare(b.sources.join(",")),
  );
  for (const group of ranked) {
    const setKey = `${group.scope}\u0001${group.sources.join("\u0000")}`;
    let node = sets.get(setKey);
    if (node === undefined) {
      const open = machine.states.filter(
        (state) => scopeOf(state.id) === group.scope && !state.final,
      );
      const everyone =
        open.length === group.sources.length &&
        open.every((state) => group.sources.includes(state.id));
      const prefix = group.scope === "" ? "" : `${group.scope}.`;
      const count = (counts.get(group.scope) ?? 0) + (everyone ? 0 : 1);
      counts.set(group.scope, count);
      node = {
        id: everyone ? `${prefix}*` : `${prefix}*${count}`,
        scope: group.scope,
        states: group.sources,
        label: everyone ? ANY_LABEL : labelOf(group.sources),
      };
      sets.set(setKey, node);
      nodes.push(node);
    }
    const nodeId = node.id;
    (group.entries[0] ?? []).forEach((entry, index) => {
      const members = group.entries.flatMap((entries) => entries[index]?.edge ?? []);
      const id = `shared:${nodeId}>${group.event}#${index}`;
      arrows.push({
        id,
        node: nodeId,
        event: group.event,
        members,
        drawn: { ...entry.edge, id, from: nodeId },
      });
    });
  }
  const hidden = new Set(arrows.flatMap((arrow) => arrow.members.map((edge) => edge.id)));
  return {
    edges: [...machine.edges.filter((edge) => !hidden.has(edge.id)), ...arrows.map((a) => a.drawn)],
    nodes,
    arrows,
  };
}

/** The member a click acts on: the one whose source state is current, if any. */
export function memberAt(arrow: SharedArrow, currents: ReadonlyArray<string>): VizEdge | undefined {
  return arrow.members.find((member) => currents.includes(member.from));
}
