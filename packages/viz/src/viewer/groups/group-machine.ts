import { isAnyState, scopeOf } from "../../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../../schema.ts";
import type { GroupNode } from "./fold-groups.ts";
import { groupNodesOf } from "./fold-groups.ts";

/** Each machine's entered groups by node id, so a group entered again is the same machine and keeps its layout. */
const enteredGroups = new WeakMap<VizMachine, Map<string, VizMachine>>();

interface GroupQuery {
  /** The group node id, as `foldGroups` draws it. */
  group: string;
}

/**
 * The view inside a group: its own states, the outside states its edges come
 * from or reach as stubs, and the real edges unchanged. Takes the real
 * machine, not a fold or a view. Undefined for an unknown group.
 */
export function groupMachine(machine: VizMachine, options: GroupQuery): VizMachine | undefined {
  const views = enteredGroups.get(machine) ?? new Map<string, VizMachine>();
  enteredGroups.set(machine, views);
  const known = views.get(options.group);
  if (known !== undefined) return known;
  const node = groupNodesOf(machine).find((each) => each.id === options.group);
  if (node === undefined) return undefined;
  const view = enter(machine, { node });
  views.set(options.group, view);
  return view;
}

interface Entering {
  node: GroupNode;
}

/** An edge the group's states can take or reach: from or to a member, or `onAny` in the group's scope. */
function touches(edge: VizEdge, options: Entering): boolean {
  const { node } = options;
  const anyHere = isAnyState(edge.from) && scopeOf(edge.from) === node.scope;
  const reaches = edge.to !== null && node.states.includes(edge.to);
  return anyHere || reaches || node.states.includes(edge.from);
}

interface Reached {
  node: GroupNode;
  edges: ReadonlyArray<VizEdge>;
}

/** A copy without `group`, so the view never folds again. */
function withoutGroup(state: VizState): VizState {
  const copy = { ...state };
  delete copy.group;
  return copy;
}

function viewStates(machine: VizMachine, options: Reached): VizState[] {
  const { node, edges } = options;
  const ends = new Set<string>();
  for (const edge of edges) {
    ends.add(edge.from);
    if (edge.to !== null) ends.add(edge.to);
  }
  const states: VizState[] = [];
  for (const state of machine.states) {
    const stub = { ...withoutGroup(state), initial: false, effects: [] };
    if (node.states.includes(state.id)) states.push(withoutGroup(state));
    else if (ends.has(state.id)) states.push(stub);
  }
  return states;
}

interface Kept {
  states: ReadonlyArray<VizState>;
}

/** True when a state of the view sits in the region or below it. */
function holds(region: string, options: Kept): boolean {
  return options.states.some((state) => state.id.startsWith(`${region}.`));
}

function enter(machine: VizMachine, options: Entering): VizMachine {
  const { node } = options;
  const edges = machine.edges.filter((edge) => touches(edge, options));
  const states = viewStates(machine, { node, edges });
  const ids = new Set(states.map((state) => state.id));
  for (const edge of edges) if (isAnyState(edge.from)) ids.add(edge.from);
  const kept = { states };
  const { initial, fuzz } = machine;
  return {
    ...machine,
    initial: initial !== null && node.states.includes(initial) ? initial : null,
    regions: machine.regions.filter((region) => holds(region, kept)),
    maps: machine.maps.filter((map) => holds(map, kept)),
    actors: machine.actors.filter((actor) => holds(actor, kept)),
    states,
    edges,
    fuzz:
      fuzz === null
        ? fuzz
        : {
            ...fuzz,
            messages: fuzz.messages.filter(
              (message) => ids.has(message.from) && ids.has(message.to),
            ),
          },
  };
}
