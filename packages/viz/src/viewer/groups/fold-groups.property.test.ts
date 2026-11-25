import {
  arrowMembersOf,
  drawnNodeOf,
  foldGroups,
  groupArrowsOf,
  groupNodesOf,
} from "./fold-groups.ts";
import { describe, expect, test } from "vite-plus/test";
import { isAnyState, scopeOf } from "../../schema.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import fc from "fast-check";
import { groupedArbitrary } from "./grouped.arbitrary.ts";
import { groupMachine } from "./group-machine.ts";
import { layoutMachine } from "../layout.ts";

const run = { seed: 0x6a0, numRuns: 1000 };

function isInside(machine: VizMachine, edge: VizEdge): boolean {
  const from = drawnNodeOf(machine, { state: edge.from });
  const grouped = from !== edge.from;
  return grouped && edge.to !== null && drawnNodeOf(machine, { state: edge.to }) === from;
}

/** Each real edge with how often the fold draws it, alone or as an arrow member; 0 when inside a group. */
function edgeCounts(machine: VizMachine): string[] {
  const folded = foldGroups(machine);
  const problems: string[] = [];
  for (const edge of machine.edges) {
    const alone = folded.edges.filter((drawn) => drawn.id === edge.id).length;
    const merged = groupArrowsOf(machine).filter((arrow) => arrow.members.includes(edge)).length;
    const expected = isInside(machine, edge) ? 0 : 1;
    if (alone + merged !== expected) problems.push(`${edge.id} drawn ${alone} + ${merged}`);
  }
  for (const drawn of folded.edges) {
    const members = arrowMembersOf(machine, { arrow: drawn.id });
    const ends = members.every((member) => {
      const target = member.to === null ? member.to : drawnNodeOf(machine, { state: member.to });
      const alike = member.event === drawn.event && member.kind === drawn.kind;
      const from = drawnNodeOf(machine, { state: member.from });
      return alike && from === drawn.from && target === drawn.to;
    });
    if (members.length === 0 || !ends) problems.push(`${drawn.id} has wrong members`);
  }
  return problems;
}

/** Real states not drawn exactly once, and drawn nodes that are neither a real state nor a group. */
function stateCounts(machine: VizMachine): string[] {
  const folded = foldGroups(machine);
  const drawn = folded.states.map((state) => state.id);
  const problems: string[] = [];
  for (const state of machine.states) {
    const node = drawnNodeOf(machine, { state: state.id });
    const count = drawn.filter((id) => id === node).length;
    if (count !== 1) problems.push(`${state.id} drawn ${count} times`);
    if (scopeOf(node) !== scopeOf(state.id)) problems.push(`${node} is not in ${state.id}'s scope`);
  }
  const groups = groupNodesOf(machine).map((node) => node.id);
  const real = new Set(machine.states.map((state) => state.id));
  const unique = new Set(drawn).size === drawn.length;
  if (!unique) problems.push("a node is drawn twice");
  for (const id of drawn) {
    if (!real.has(id) && !groups.includes(id)) problems.push(`${id} is made up`);
  }
  for (const node of groupNodesOf(machine)) {
    const mapped = machine.maps.some(
      (map) => node.scope === map || node.scope.startsWith(`${map}.`),
    );
    if (mapped) problems.push(`${node.id} is in a map`);
  }
  return problems;
}

/** Real edges neither the fold nor an entered group draws, and entered edges whose ends are not drawn there. */
function coverage(machine: VizMachine): string[] {
  const entered = groupNodesOf(machine).flatMap(
    (node) => groupMachine(machine, { group: node.id }) ?? [],
  );
  const folded = new Set(
    foldGroups(machine).edges.flatMap((drawn) => arrowMembersOf(machine, { arrow: drawn.id })),
  );
  const problems: string[] = [];
  for (const edge of machine.edges) {
    const seen = folded.has(edge) || entered.some((view) => view.edges.includes(edge));
    if (!seen) problems.push(`${edge.id} is never drawn`);
  }
  for (const view of entered) {
    const ids = new Set(view.states.map((state) => state.id));
    for (const edge of view.edges) {
      const from = ids.has(edge.from) || isAnyState(edge.from);
      const target = edge.to === null || ids.has(edge.to);
      if (!from || !target) problems.push(`${edge.id} leaves the view`);
    }
  }
  return problems.concat(missingFromViews(machine));
}

/** Real edges from or to a group's states, or onAny in its scope, that the entered group leaves out; and views that would fold again. */
function missingFromViews(machine: VizMachine): string[] {
  const problems: string[] = [];
  for (const node of groupNodesOf(machine)) {
    const view = groupMachine(machine, { group: node.id });
    const again = view !== undefined && groupNodesOf(view).length > 0;
    if (view === undefined) problems.push(`${node.id} has no view`);
    if (again) problems.push(`${node.id} folds again`);
    for (const edge of machine.edges) {
      const anyHere = isAnyState(edge.from) && scopeOf(edge.from) === node.scope;
      const member = [edge.from, edge.to].some((end) => end !== null && node.states.includes(end));
      const missed = (anyHere || member) && view?.edges.includes(edge) !== true;
      if (missed) problems.push(`${node.id} misses ${edge.id}`);
    }
  }
  const folded = foldGroups(machine);
  if (foldGroups(folded) !== folded) problems.push("the fold folds again");
  return problems;
}

describe("groups on generated machines", () => {
  test("G1: every real edge is inside a group, one drawn edge, or a member of one arrow", () => {
    fc.assert(
      fc.property(groupedArbitrary, (machine) => {
        expect(edgeCounts(machine)).toEqual([]);
      }),
      run,
    );
  });

  test("G2: every state is drawn exactly once at the top level", () => {
    fc.assert(
      fc.property(groupedArbitrary, (machine) => {
        expect(stateCounts(machine)).toEqual([]);
      }),
      run,
    );
  });

  test("G3: the fold and the entered groups together draw every edge, and neither folds again", () => {
    fc.assert(
      fc.property(groupedArbitrary, (machine) => {
        expect(coverage(machine)).toEqual([]);
      }),
      run,
    );
  });

  test("G4: the fold and each entered group lay out with no overlaps", () => {
    fc.assert(
      fc.property(groupedArbitrary, (machine) => {
        const views = groupNodesOf(machine).flatMap(
          (node) => groupMachine(machine, { group: node.id }) ?? [],
        );
        const overlaps = [foldGroups(machine), ...views].map(
          (view) => layoutMachine(view)[1]?.overlaps.length,
        );
        expect(overlaps).toEqual(overlaps.map(() => 0));
      }),
      { ...run, numRuns: 200 },
    );
  }, 60_000);
});
