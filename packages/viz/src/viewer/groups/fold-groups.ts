import { actorMapOf, groupNameProblem, isAnyState, scopeOf } from "../../schema.ts";
import type { VizCoverage, VizEdge, VizFuzzMessage, VizMachine, VizState } from "../../schema.ts";
import { localName } from "../compartments.ts";

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
  /** What is drawn: the first member, pointed at the group nodes, with the event and no condition. */
  drawn: VizEdge;
}

interface Folded {
  real: VizMachine;
  machine: VizMachine;
  nodes: GroupNode[];
  arrows: GroupArrow[];
  nodeOfState: ReadonlyMap<string, string>;
  membersOfEdge: ReadonlyMap<string, VizEdge[]>;
}

/** Each machine's fold, so the same machine folds once and keeps its layout. A fold is its own fold, so the helpers answer alike for both. */
const folds = new WeakMap<VizMachine, Folded>();

function foldedOf(machine: VizMachine): Folded {
  const known = folds.get(machine);
  if (known !== undefined) return known;
  const folded = fold(machine);
  folds.set(machine, folded);
  folds.set(folded.machine, folded);
  return folded;
}

/**
 * The machine with each group drawn as one node: crossing edges pointed at the
 * group node, and edges inside a group drawn as loops on it, so every move of
 * the walk has an arrow. Every drawn edge of a handler with an end in a group
 * has no explanation; read its real edges with `arrowMembersOf`.
 */
export function foldGroups(machine: VizMachine): VizMachine {
  return foldedOf(machine).machine;
}

/** The real machine of a fold, or the machine itself. */
export function realMachineOf(machine: VizMachine): VizMachine {
  return foldedOf(machine).real;
}

export interface GroupNodeQuery {
  /** A drawn node id, as `data-node-id` holds it. */
  node: string;
}

/** The group node a drawn id names; undefined for a state. */
export function groupNodeAt(machine: VizMachine, options: GroupNodeQuery): GroupNode | undefined {
  return foldedOf(machine).nodes.find((each) => each.id === options.node);
}

/**
 * A drawn node as text names it, as the canvas draws it: a group node by its
 * group's name, an `onAny` source as "any state", a state by its name in its
 * region, or by its full id when another state of the machine has that name.
 */
export function drawnNodeName(machine: VizMachine, options: GroupNodeQuery): string {
  const { node } = options;
  if (isAnyState(node)) return "any state";
  const group = groupNodeAt(machine, { node });
  if (group !== undefined) return `group ${group.name}`;
  const name = localName(node);
  const shared = machine.states.some((state) => state.id !== node && localName(state.id) === name);
  return shared ? node : name;
}

/** The group nodes of the real machine; its fold gives the same. */
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
  const taken = new Set(machine.states.map((state) => state.id));
  for (const state of machine.states) {
    const id = groupIdOf(state, machine);
    if (id === undefined || taken.has(id)) continue;
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

interface Arrowing extends FirstMember {
  /** Handlers with an edge the fold moves or drops, by `handlerKey`. */
  touched: ReadonlySet<string>;
}

interface DrawnId extends Arrowing {
  id: string;
}

/** The real source and event of an edge: one handler. */
export function handlerKey(edge: VizEdge): string {
  return `${edge.from}\u0000${edge.event}`;
}

/** The handlers with an edge that has an end in a group, so the fold moves or drops it. */
function touchedHandlers(edges: ReadonlyArray<VizEdge>, options: NodeIndex): Set<string> {
  const { nodeOfState } = options;
  const touched = edges.filter(
    (edge) => nodeOfState.has(edge.from) || (edge.to !== null && nodeOfState.has(edge.to)),
  );
  return new Set(touched.map((edge) => handlerKey(edge)));
}

/**
 * The edge drawn for a bucket, with the coverage of all its members. A
 * handler that the fold touches draws its event only: a condition read from
 * real targets says nothing true about group nodes, and an "else" needs every
 * partner to show its condition. The entered group draws the real reading.
 */
function drawnEdge(bucket: Bucket, options: DrawnId): VizEdge {
  const { first, id, touched } = options;
  const { from, target, members } = bucket;
  if (!touched.has(handlerKey(first))) return first;
  const oneHandler = members.every((member) => handlerKey(member) === handlerKey(first));
  return {
    ...first,
    id,
    from,
    to: target,
    explanation: null,
    doc: oneHandler ? first.doc : null,
    coverage: summed(members.map((member) => member.coverage)),
    tested: summed(members.map((member) => member.tested)),
  };
}

function arrowOf(bucket: Bucket, options: Arrowing): GroupArrow {
  const { first } = options;
  const { from, target, members } = bucket;
  const shown = target ?? "?";
  const merged = `group:${from}>${first.event}>${shown}:${first.kind}`;
  const id = members.length === 1 ? first.id : merged;
  return { id, members, drawn: drawnEdge(bucket, { ...options, id }) };
}

function drawnArrows(edges: ReadonlyArray<VizEdge>, options: NodeIndex): GroupArrow[] {
  const buckets = bucketsOf(edges, options);
  const touched = touchedHandlers(edges, options);
  const arrows: GroupArrow[] = [];
  for (const bucket of buckets) {
    const [first] = bucket.members;
    if (first !== undefined) arrows.push(arrowOf(bucket, { first, touched }));
  }
  return arrows;
}

/** Messages with their ends on drawn nodes, once each; one inside a group is dropped. */
function foldedMessages(
  messages: ReadonlyArray<VizFuzzMessage>,
  options: NodeIndex,
): VizFuzzMessage[] {
  const { nodeOfState } = options;
  const folded = new Map<string, VizFuzzMessage>();
  for (const message of messages) {
    const from = nodeOfState.get(message.from) ?? message.from;
    const target = nodeOfState.get(message.to) ?? message.to;
    const inside = from === target && nodeOfState.has(message.from);
    const key = [from, message.event, target].join("\u0000");
    if (!inside) folded.set(key, { ...message, from, to: target });
  }
  return [...folded.values()];
}

interface Drawn extends NodeIndex {
  arrows: ReadonlyArray<GroupArrow>;
}

/** The fold of a machine with groups; one without is drawn as it is. */
function drawnOf(machine: VizMachine, options: Drawn): VizMachine {
  const { nodeOfState, arrows } = options;
  const { initial, fuzz } = machine;
  return {
    ...machine,
    initial: initial === null ? initial : (nodeOfState.get(initial) ?? initial),
    states: foldedStates(machine, options),
    edges: arrows.map((arrow) => arrow.drawn),
    fuzz: fuzz === null ? fuzz : { ...fuzz, messages: foldedMessages(fuzz.messages, options) },
  };
}

function fold(machine: VizMachine): Folded {
  const nodes = nodesOf(machine);
  const nodeOfState = new Map<string, string>();
  for (const node of nodes) for (const state of node.states) nodeOfState.set(state, node.id);
  const index: NodeIndex = { nodes, nodeOfState };
  const arrows = drawnArrows(machine.edges, index);
  return {
    real: machine,
    machine: nodes.length === 0 ? machine : drawnOf(machine, { ...index, arrows }),
    nodes,
    arrows: arrows.filter((arrow) => arrow.members.length > 1),
    nodeOfState,
    membersOfEdge: new Map(arrows.map((arrow) => [arrow.id, arrow.members])),
  };
}
