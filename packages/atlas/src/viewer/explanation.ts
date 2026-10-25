import type {
  AtlasBranch,
  AtlasComparison,
  AtlasEdge,
  AtlasExplanation,
  AtlasLocation,
  AtlasMachine,
} from "../schema.ts";
import { html } from "./dom.ts";

function where(location: AtlasLocation | null): string {
  return location === null
    ? "unknown location"
    : `${location.file}:${location.line}:${location.column}`;
}

function targetText(branch: AtlasBranch): string {
  if (branch.target.kind === "state") return branch.target.state;
  if (branch.target.kind === "stay") return "(stay)";
  return `? ${branch.target.text}`;
}

/** Does the graph hold an edge for this branch from the selected edge's state? */
function inGraph(
  branch: AtlasBranch,
  context: { edge: AtlasEdge; machine: AtlasMachine },
): boolean {
  const { edge, machine } = context;
  const target = branch.target;
  return machine.edges.some((candidate) => {
    if (candidate.from !== edge.from || candidate.event !== edge.event) return false;
    if (target.kind === "stay") return candidate.kind === "stay";
    return target.kind === "state" && candidate.to === target.state;
  });
}

function isThisEdge(branch: AtlasBranch, edge: AtlasEdge): boolean {
  if (branch.target.kind === "stay") return edge.kind === "stay";
  return branch.target.kind === "state" && branch.target.state === edge.to;
}

function branchItem(
  doc: Document,
  branch: AtlasBranch,
  context: { edge: AtlasEdge; machine: AtlasMachine },
) {
  const condition = branch.conditions.length === 0 ? "always" : branch.conditions.join(" && ");
  const status = isThisEdge(branch, context.edge)
    ? "this edge"
    : inGraph(branch, context)
      ? "in graph"
      : "not in graph";
  return html(doc, "li", { class: "branch", "data-branch-status": status }, [
    html(doc, "code", {}, [condition]),
    ` → ${targetText(branch)} `,
    html(doc, "span", { class: "branch-status" }, [`(${status})`]),
  ]);
}

function comparisonText(comparison: AtlasComparison): string {
  return `${comparison.source}.${comparison.path} ${comparison.operator} ${JSON.stringify(comparison.literal)}`;
}

function line(doc: Document, label: string, value: string): HTMLElement {
  return html(doc, "p", { "data-explain": label }, [
    html(doc, "span", { class: "muted" }, [`${label}: `]),
    value,
  ]);
}

function joined(values: ReadonlyArray<string>): string {
  return values.length === 0 ? "none" : values.join(", ");
}

/**
 * Static explanation of an edge's handler. Branches the graph lacks are
 * listed as "not in graph": the AST annotates, it never adds edges.
 */
export function renderExplanation(
  doc: Document,
  context: { edge: AtlasEdge; machine: AtlasMachine },
): Node | string {
  const explanation: AtlasExplanation | null = context.edge.explanation;
  if (explanation === null) {
    const kind = context.edge.kind;
    return kind === "initial" || kind === "effect" ? "no handler behind this edge" : "not analyzed";
  }
  if (explanation.status === "not_analyzed") {
    return html(doc, "div", { class: "explanation not-analyzed" }, [
      line(doc, "not analyzed", explanation.reason),
      line(doc, "at", where(explanation.location)),
      explanation.snippet === null ? null : html(doc, "pre", {}, [explanation.snippet]),
    ]);
  }
  return html(doc, "div", { class: "explanation" }, [
    line(doc, "at", `${where(explanation.location)} (m.${explanation.registration})`),
    html(
      doc,
      "ul",
      { class: "branches" },
      explanation.branches.map((branch) => branchItem(doc, branch, context)),
    ),
    explanation.readsActorState
      ? line(doc, "note", "reads live actor state; probing cannot determine the target")
      : null,
    line(doc, "payload reads", joined(explanation.payloadReads)),
    line(doc, "context reads", joined(explanation.contextReads)),
    line(doc, "context writes", joined(explanation.contextWrites)),
    line(doc, "comparisons", joined(explanation.comparisons.map(comparisonText))),
  ]);
}
