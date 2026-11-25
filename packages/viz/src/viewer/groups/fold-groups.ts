import { actorMapOf, groupNameProblem, scopeOf } from "../../schema.ts";
import type { VizCoverage, VizEdge, VizFuzzMessage, VizMachine, VizState } from "../../schema.ts";

/** A group drawn as one node: `<scope>.@<name>`, or `@<name>` at the root, so `scopeOf` stays the members' scope. */
export interface GroupNode {
  id: string;
  name: string;
  scope: string;
  /** The real states it stands for, in document order. */
  states: string[];
}

/** Several real edges that cross a group boundary alike, drawn as one arrow. */
export interface GroupArrow {
  id: string;
  /** The real edges, in document order. */
  members: VizEdge[];
  /** What is drawn: the first member, pointed at the group nodes. */
  drawn: VizEdge;
}

interface Folded {
  machine: VizMachine;
  nodes: GroupNode[];
  arrows: GroupArrow[];
  nodeOfState: ReadonlyMap<string, string>;
  membersOfEdge: ReadonlyMap<string, VizEdge[]>;
}

/** Each machine's fold, so the same machine folds once and keeps its layout. */
const folds = new WeakMap<VizMachine, Folded>();

function foldedOf(machine: VizMachine): Folded {
  const known = folds.get(machine);
  if (known !== undefined) return known;
  const folded = fold(machine);
  folds.set(machine, folded);
  return folded;
}

/** The machine with each group drawn as one node: edges inside a group dropped, crossing edges pointed at the group node. */
export function foldGroups(machine: VizMachine): VizMachine {
  return foldedOf(machine).machine;
}

export function groupNodesOf(machine: VizMachine): ReadonlyArray<GroupNode> {
  return foldedOf(machine).nodes;
}

/** Arrows of the fold that stand for more than one real edge. */
export function groupArrowsOf(machine: VizMachine): ReadonlyArray<GroupArrow> {
  return foldedOf(machine).arrows;
}

interface StateQuery {
  state: string;
}

/** The node that draws a real state in the fold: its group node, or the state itself. */
export function drawnNodeOf(machine: VizMachine, options: StateQuery): string {
  return foldedOf(machine).nodeOfState.get(options.state) ?? options.state;
}

interface ArrowQuery {
  arrow: string;
}

/** The real edges a drawn edge of the fold stands for; empty for an id the fold does not draw. */
export function arrowMembersOf(machine: VizMachine, options: ArrowQuery): ReadonlyArray<VizEdge> {
  return foldedOf(machine).membersOfEdge.get(options.arrow) ?? [];
}

/** The group node id of a state, or undefined when the state is in no group the viewer can fold. */
function groupIdOf(state: VizState, machine: VizMachine): string | undefined {
  const { group } = state;
  if (group === undefined || groupNameProblem(group) !== undefined) return undefined;
  if (actorMapOf(state.id, machine) !== undefined) return undefined;
  const scope = scopeOf(state.id);
  return scope === "" ? `@${group}` : `${scope}.@${group}`;
}

function nodesOf(machine: VizMachine): GroupNode[] {
  const nodes = new Map<string, GroupNode>();
  for (const state of machine.states) {
    const id = groupIdOf(state, machine);
    if (id === undefined) continue;
    const node = nodes.get(id) ?? {
      id,
      name: state.group ?? id,
      scope: scopeOf(state.id),
      states: [],
    };
    node.states.push(state.id);
    nodes.set(id, node);
  }
  return [...nodes.values()];
}

function summed(counts: ReadonlyArray<VizCoverage | null>): VizCoverage | null {
  const known = counts.filter((count) => count !== null);
  if (known.length === 0) return null;
  return { hits: known.reduce((sum, count) => sum + count.hits, 0) };
}

interface Members {
  first: VizState;
  members: ReadonlyArray<VizState>;
}

function nodeState(node: GroupNode, options: Members): VizState {
  const { first, members } = options;
  return {
    id: node.id,
    label: node.name,
    region: first.region,
    initial: members.some((member) => member.initial),
    final: members.every((member) => member.final),
    effects: [],
    coverage: summed(members.map((member) => member.coverage)),
    tested: summed(members.map((member) => member.tested)),
    doc: null,
    group: node.name,
  };
}

/** The states of the fold: each group node in the place of its first member. */
function foldedStates(machine: VizMachine, options: NodeIndex): VizState[] {
  const { nodes, nodeOfState } = options;
  const states: VizState[] = [];
  for (const state of machine.states) {
    const node = nodes.find((each) => each.id === nodeOfState.get(state.id));
    if (node === undefined) {
      states.push(state);
      continue;
    }
    if (node.states[0] !== state.id) continue;
    const members = machine.states.filter((member) => node.states.includes(member.id));
    states.push(nodeState(node, { first: state, members }));
  }
  return states;
}

/** The real edges that become one drawn edge: same drawn ends, event and kind. */
interface Bucket {
  from: string;
  target: string | null;
  members: VizEdge[];
}

interface NodeIndex {
  nodes: ReadonlyArray<GroupNode>;
  nodeOfState: ReadonlyMap<string, string>;
}

function bucketsOf(edges: ReadonlyArray<VizEdge>, options: NodeIndex): Bucket[] {
  const { nodeOfState } = options;
  const buckets = new Map<string, Bucket>();
  for (const edge of edges) {
    const from = nodeOfState.get(edge.from) ?? edge.from;
    const target = edge.to === null ? null : (nodeOfState.get(edge.to) ?? edge.to);
    const moved = from !== edge.from || target !== edge.to;
    if (moved && from === target) continue;
    const key = moved ? [from, edge.event, target ?? "", edge.kind].join("\u0000") : edge.id;
    const bucket = buckets.get(key) ?? { from, target, members: [] };
    bucket.members.push(edge);
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

interface FirstMember {
  first: VizEdge;
}

function arrowOf(bucket: Bucket, options: FirstMember): GroupArrow {
  const { first } = options;
  const { from, target, members } = bucket;
  const shown = target ?? "?";
  const merged = `group:${from}>${first.event}>${shown}:${first.kind}`;
  const id = members.length === 1 ? first.id : merged;
  const unmoved = from === first.from && target === first.to;
  const drawn = unmoved ? first : { ...first, id, from, to: target };
  return { id, members, drawn };
}

function drawnArrows(edges: ReadonlyArray<VizEdge>, options: NodeIndex): GroupArrow[] {
  const arrows: GroupArrow[] = [];
  for (const bucket of bucketsOf(edges, options)) {
    const [first] = bucket.members;
    if (first !== undefined) arrows.push(arrowOf(bucket, { first }));
  }
  return arrows;
}

/** Messages with their ends on drawn nodes; one inside a group is dropped. */
function foldedMessages(
  messages: ReadonlyArray<VizFuzzMessage>,
  options: NodeIndex,
): VizFuzzMessage[] {
  const { nodeOfState } = options;
  const folded: VizFuzzMessage[] = [];
  for (const message of messages) {
    const from = nodeOfState.get(message.from) ?? message.from;
    const target = nodeOfState.get(message.to) ?? message.to;
    const inside = from === target && nodeOfState.has(message.from);
    if (!inside) folded.push({ ...message, from, to: target });
  }
  return folded;
}

function fold(machine: VizMachine): Folded {
  const nodes = nodesOf(machine);
  const nodeOfState = new Map<string, string>();
  for (const node of nodes) for (const state of node.states) nodeOfState.set(state, node.id);
  const index: NodeIndex = { nodes, nodeOfState };
  const arrows = drawnArrows(machine.edges, index);
  const { initial, fuzz } = machine;
  return {
    machine: {
      ...machine,
      initial: initial === null ? null : (nodeOfState.get(initial) ?? initial),
      states: foldedStates(machine, index),
      edges: arrows.map((arrow) => arrow.drawn),
      fuzz: fuzz === null ? fuzz : { ...fuzz, messages: foldedMessages(fuzz.messages, index) },
    },
    nodes,
    arrows: arrows.filter((arrow) => arrow.members.length > 1),
    nodeOfState,
    membersOfEdge: new Map(arrows.map((arrow) => [arrow.id, arrow.members])),
  };
}
