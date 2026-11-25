import { arrowMembersOf, groupNodeAt, realMachineOf } from "./groups/fold-groups.ts";
import { isAnyState, scopeOf } from "../schema.ts";
import type { VizEdge, VizMachine } from "../schema.ts";
import { edgeLines } from "./labels.ts";

/** Fewest sibling states that take an event alike before it is drawn once. */
const SHARE_FROM = 3;
const ANY_LABEL = "any state";

interface SharedNode {
  id: string;
  scope: string;
  /** The drawn states it stands for: states, and group nodes of a fold. */
  states: string[];
  /** The real states that take its arrows: the node is current while the walk is in one. A group node stands for only those of its states. */
  walked: string[];
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
  /** The real states the sources' edges leave from. */
  walked: string[];
  entries: Entry[][];
}

/** The real states drawn edges leave from: a group arrow's members' sources, or the edge's own. */
function realSourcesOf(machine: VizMachine, edges: ReadonlyArray<VizEdge>): string[] {
  const sources: string[] = [];
  for (const edge of edges) {
    const members = arrowMembersOf(machine, { arrow: edge.id });
    for (const member of members.length === 0 ? [edge] : members) {
      if (!sources.includes(member.from)) sources.push(member.from);
    }
  }
  return sources;
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
      const group = groups.get(id) ?? { scope, event, sources: [], walked: [], entries: [] };
      group.sources.push(state.id);
      group.walked.push(...realSourcesOf(machine, edges));
      group.entries.push(entries);
      groups.set(id, group);
    }
  }
  return [...groups.values()].filter((group) => group.sources.length >= SHARE_FROM);
}

function labelOf(states: ReadonlyArray<string>): string {
  return `${states.length} states`;
}

/** Whether a group's sources are every open state of its scope, and each group node among them leaves from all its open states: only then is it `any state`. */
function isEveryone(machine: VizMachine, group: Group): boolean {
  const open = machine.states.filter((state) => scopeOf(state.id) === group.scope && !state.final);
  const drawn =
    open.length === group.sources.length && open.every((state) => group.sources.includes(state.id));
  if (!drawn) return false;
  const real = realMachineOf(machine).states;
  for (const source of group.sources) {
    const node = groupNodeAt(machine, { node: source });
    const states = real.filter((state) => node?.states.includes(state.id) && !state.final);
    if (states.some((state) => !group.walked.includes(state.id))) return false;
  }
  return true;
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
    const walked = [...group.walked].sort((a, b) => a.localeCompare(b));
    const setKey = [group.scope, group.sources.join("\u0000"), walked.join("\u0000")].join(
      "\u0001",
    );
    let node = sets.get(setKey);
    if (node === undefined) {
      const everyone = isEveryone(machine, group);
      const prefix = group.scope === "" ? "" : `${group.scope}.`;
      const count = (counts.get(group.scope) ?? 0) + (everyone ? 0 : 1);
      counts.set(group.scope, count);
      node = {
        id: everyone ? `${prefix}*` : `${prefix}*${count}`,
        scope: group.scope,
        states: group.sources,
        walked: group.walked,
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

/** Shared arrows by machine: the marks ask for each arrow after every step. */
const sharedOf = new WeakMap<VizMachine, Shared>();

/** `shareArrows`, worked out once per machine. */
export function sharedArrowsOf(machine: VizMachine): Shared {
  const known = sharedOf.get(machine);
  if (known !== undefined) return known;
  const shared = shareArrows(machine);
  sharedOf.set(machine, shared);
  return shared;
}
