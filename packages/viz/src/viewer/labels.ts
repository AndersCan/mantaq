import type { VizBranch, VizEdge } from "../schema.ts";
import { localName } from "./compartments.ts";

const MAX_CONDITION = 32;

const FLIP: ReadonlyArray<readonly [string, string]> = [
  ["===", "!=="],
  ["!==", "==="],
  ["==", "!="],
  ["!=", "=="],
  [">=", "<"],
  ["<=", ">"],
  ["<", ">="],
  [">", "<="],
];

/** Text drawn on an edge: the event it carries. */
export function edgeText(edge: VizEdge): string {
  return edge.event;
}

/** `!(a === b)` becomes `a !== b` when the inside is one comparison; anything else is kept. */
function tidy(condition: string): string {
  const plain = condition.replaceAll("event.payload.", "").replaceAll("context.get().", "");
  const negated = /^!\((.*)\)$/.exec(plain)?.[1];
  if (negated === undefined) return plain;
  const found = FLIP.find(([from]) => negated.split(from).length === 2 && !/[&|()]/.test(negated));
  if (found === undefined) return plain;
  const [from, to] = found;
  const [left = "", right = ""] = negated.split(from);
  return `${left.trim()} ${to} ${right.trim()}`;
}

function goes(branch: VizBranch, to: string): boolean {
  return branch.target.kind === "state" && branch.target.state === to;
}

function allOf(branch: VizBranch): string {
  const { conditions } = branch;
  if (conditions.length === 1) return tidy(conditions[0] ?? "");
  return conditions
    .map(tidy)
    .map((c) => (c.includes("||") ? `(${c})` : c))
    .join(" && ");
}

/**
 * When a handler can also go elsewhere, the condition under which it reaches
 * `edge.to`, read from the analyzed branches. null when it is unconditional,
 * unreadable, or depends on actor state.
 */
export function edgeCondition(edge: VizEdge): string | null {
  const { explanation } = edge;
  if (edge.kind !== "transition" || edge.to === null) return null;
  if (explanation === null || explanation.status !== "analyzed" || explanation.readsActorState) {
    return null;
  }
  const to = localName(edge.to);
  const going = explanation.branches.filter((branch) => goes(branch, to));
  if (going.length === 0 || going.length === explanation.branches.length) return null;
  if (going.some((branch) => branch.conditions.length === 0)) return null;
  if (explanation.branches.some((branch) => branch.target.kind === "unresolved")) return null;
  return going.map(allOf).join(" || ");
}

/** The lines drawn on an edge: the event, then its condition cut to fit. */
export function edgeLines(edge: VizEdge): string[] {
  const condition = edgeCondition(edge);
  if (condition === null) return [edgeText(edge)];
  const cut =
    condition.length > MAX_CONDITION ? `${condition.slice(0, MAX_CONDITION - 1)}…` : condition;
  return [edgeText(edge), cut];
}
