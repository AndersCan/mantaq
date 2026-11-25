import fc from "fast-check";
import { machineArbitrary } from "../layout.arbitrary.ts";
import { scopeOf } from "../../schema.ts";
import type { VizMachine } from "../../schema.ts";

/** Most groups a scope gets; a state draws 0 (no group) up to this. */
const GROUPS_PER_SCOPE = 2;
/** The event most edges share, so crossing edges merge into arrows. */
const SHARED_EVENT = "go";
/** One edge in this many keeps its own event. */
const OWN_EVENT_ODDS = 4;

/**
 * `machineArbitrary` with some states in groups, one name set per region scope,
 * and most edges on a shared event. Map states get groups too, which the fold leaves out.
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
      return { ...machine, states, edges };
    }),
);
