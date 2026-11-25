import type { VizBranch, VizEdge, VizMachine } from "../../schema.ts";
import fc from "fast-check";
import { localName } from "../compartments.ts";
import { machineArbitrary } from "../layout.arbitrary.ts";
import { readEdge } from "./shop-machines.ts";
import { scopeOf } from "../../schema.ts";

/** Most groups a scope gets; a state draws 0 (no group) up to this. */
const GROUPS_PER_SCOPE = 2;
/** The event most edges share, so crossing edges merge into arrows. */
const SHARED_EVENT = "go";
/** One edge in this many keeps its own event. */
const OWN_EVENT_ODDS = 4;

/** An if / else-if / else chain over the targets, one branch per target. */
function chainOf(targets: ReadonlyArray<string>): VizBranch[] {
  return targets.map((target, index) => {
    const before = Array.from({ length: index }, (_, earlier) => `!(c${earlier})`);
    const own = index === targets.length - 1 ? [] : [`c${index}`];
    return { conditions: [...before, ...own], target: { kind: "state", state: localName(target) } };
  });
}

/** The real source and event of an edge: one handler. */
function handlerKey(edge: VizEdge): string {
  return `${edge.from}\u0000${edge.event}`;
}

/** Each handler with two or more transitions reads as one chain that splits across its targets. */
function splitHandlers(edges: ReadonlyArray<VizEdge>): VizEdge[] {
  const targets = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "transition" || edge.to === null) continue;
    targets.set(handlerKey(edge), [...(targets.get(handlerKey(edge)) ?? []), edge.to]);
  }
  return edges.map((edge) => {
    const chain = targets.get(handlerKey(edge)) ?? [];
    const splits = edge.kind === "transition" && chain.length >= 2;
    return splits ? readEdge(edge, { branches: chainOf(chain) }) : edge;
  });
}

/**
 * `machineArbitrary` with some states in groups, one name set per region scope,
 * most edges on a shared event, and handlers that split across their targets. Map states get groups too, which the fold leaves out.
 */
export const groupedArbitrary: fc.Arbitrary<VizMachine> = machineArbitrary.chain((machine) =>
  fc
    .record({
      groups: fc.array(fc.integer({ min: 0, max: GROUPS_PER_SCOPE }), {
        minLength: machine.states.length,
        maxLength: machine.states.length,
      }),
      events: fc.array(fc.integer({ min: 1, max: OWN_EVENT_ODDS }), {
        minLength: machine.edges.length,
        maxLength: machine.edges.length,
      }),
    })
    .map((picks) => {
      const scopes = [...new Set(machine.states.map((state) => scopeOf(state.id)))];
      const states = machine.states.map((state, index) => {
        const pick = picks.groups[index] ?? 0;
        if (pick === 0) return state;
        const scope = scopes.indexOf(scopeOf(state.id));
        return { ...state, group: `s${scope}g${pick}` };
      });
      const edges = machine.edges.map((edge, index) => {
        const own = picks.events[index] === OWN_EVENT_ODDS;
        return { ...edge, event: own ? edge.event : SHARED_EVENT };
      });
      return { ...machine, states, edges: splitHandlers(edges) };
    }),
);
