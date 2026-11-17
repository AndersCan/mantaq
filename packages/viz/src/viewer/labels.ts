import type { VizBranch, VizEdge } from "../schema.ts";
import { localName } from "./compartments.ts";

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

function negated(condition: string | undefined): string | undefined {
  return /^!\((.*)\)$/.exec(condition ?? "")?.[1];
}

/** True when `others` holds a branch to another state that took the opposite side at `index`. */
function elseSide(branch: VizBranch, index: number, others: VizBranch[]): boolean {
  const inner = negated(branch.conditions[index]);
  if (inner === undefined) return false;
  const prefix = branch.conditions.slice(0, index).join("\n");
  return others.some(
    (other) =>
      other.conditions[index] === inner && other.conditions.slice(0, index).join("\n") === prefix,
  );
}

function branchText(
  branch: VizBranch,
  others: VizBranch[],
  shared: (condition: string) => boolean,
  allowElse: boolean,
): string | null {
  const kept: string[] = [];
  let isElse = false;
  for (const [index, condition] of branch.conditions.entries()) {
    if (shared(condition)) continue;
    if (allowElse && elseSide(branch, index, others)) isElse = true;
    else kept.push(tidy(condition));
  }

  const joined = (kept.length > 1 ? kept.map((c) => (c.includes("||") ? `(${c})` : c)) : kept).join(
    " && ",
  );
  if (joined === "") return isElse ? "else" : null;
  return isElse ? `else if ${joined}` : joined;
}

/**
 * When one event can lead to several states, what sets this arrow apart:
 * its own conditions, `else` for the side the others rule out. Null when the
 * arrow is the only way the event goes, or its handler is unreadable.
 */
export function edgeCondition(edge: VizEdge): string | null {
  const { explanation } = edge;
  if (edge.kind !== "transition" || edge.to === null) return null;
  if (explanation === null || explanation.status !== "analyzed") return null;
  const { branches } = explanation;
  if (branches.some((branch) => branch.target.kind === "unresolved")) return null;
  const to = localName(edge.to);
  const going = branches.filter((branch) => goes(branch, to));
  if (going.length === 0) return null;
  const targets = new Set(
    branches.flatMap((b) => (b.target.kind === "state" ? [b.target.state] : [])),
  );
  const hasStay = branches.some((branch) => branch.target.kind === "stay");
  if (targets.size === 1 && !hasStay) return null;
  const reaching = branches.filter((branch) => branch.target.kind === "state");
  const shared = (condition: string): boolean =>
    targets.size >= 2 && reaching.every((branch) => branch.conditions.includes(condition));
  const others = reaching.filter((branch) => !goes(branch, to));
  const texts = going.map((branch) => branchText(branch, others, shared, going.length === 1));
  if (texts.some((text) => text === null)) return null;
  return texts.join(" || ");
}

/** The lines drawn on an edge: the event, then its condition in full. */
export function edgeLines(edge: VizEdge): string[] {
  const condition = edgeCondition(edge);
  return condition === null ? [edge.event] : [edge.event, condition];
}
