import { coveredByAny, isAnyState } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { localName } from "./compartments.ts";
import { activatable, html } from "./dom.ts";
import type { Selection } from "./graph.ts";

type Row = [label: string, value: Node | string];

function list(doc: Document, rows: ReadonlyArray<Row>): HTMLDListElement {
  return html(
    doc,
    "dl",
    {},
    rows.flatMap(([label, value]) => [
      html(doc, "dt", {}, [label]),
      html(doc, "dd", { "data-field": label }, [value]),
    ]),
  );
}

function sourceText(from: string): string {
  return isAnyState(from) ? "any state" : from;
}

function edgeLink(
  doc: Document,
  edge: VizEdge,
  select: (selection: Selection) => void,
): HTMLLIElement {
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${sourceText(edge.from)} —${edge.event || "initial"}→ ${edge.to ?? "?"}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

function edgeList(
  doc: Document,
  edges: ReadonlyArray<VizEdge>,
  select: (selection: Selection) => void,
): Node | string {
  if (edges.length === 0) return "none";
  return html(
    doc,
    "ul",
    {},
    edges.map((edge) => edgeLink(doc, edge, select)),
  );
}

/** `free —ITEMS_ASSIGNED→ working`: the edge as the diagram draws it. */
function edgeTitle(edge: VizEdge): string {
  const from = isAnyState(edge.from) ? "any state" : localName(edge.from);
  const to = edge.to === null ? "?" : localName(edge.to);
  return edge.kind === "initial" ? `start → ${to}` : `${from} —${edge.event}→ ${to}`;
}

function docLine(doc: Document, scope: string, text: string | null): HTMLElement | null {
  return text === null ? null : html(doc, "p", { class: "doc", "data-doc": scope }, [text]);
}

function edgePanel(
  doc: Document,
  edge: VizEdge,
  send: ((edge: VizEdge) => HTMLElement | null) | undefined,
): HTMLElement {
  return html(doc, "section", { class: "details", "data-selected-edge": edge.id }, [
    html(doc, "h2", {}, [edgeTitle(edge)]),
    send?.(edge) ?? null,
    docLine(doc, "edge", edge.doc),
  ]);
}

function statePanel(
  doc: Document,
  state: VizState,
  context: { machine: VizMachine; select: (selection: Selection) => void },
): HTMLElement {
  const { machine, select } = context;
  const outgoing = machine.edges.filter(
    (edge) => edge.from === state.id || (!state.final && coveredByAny(edge.from, state.id)),
  );
  const incoming = machine.edges.filter((edge) => edge.to === state.id && edge.kind !== "initial");
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${state.id}`]),
    docLine(doc, "state", state.doc),
    list(doc, [
      ["outgoing", edgeList(doc, outgoing, select)],
      ["incoming", edgeList(doc, incoming, select)],
    ]),
  ]);
}

/** Side-panel body for the current selection, or a hint when nothing is selected. */
export function renderPanel(
  doc: Document,
  machine: VizMachine,
  context: {
    selection: Selection | null;
    select: (selection: Selection) => void;
    send?: (edge: VizEdge) => HTMLElement | null;
  },
): HTMLElement {
  const { selection } = context;
  if (selection?.kind === "edge") {
    const edge = machine.edges.find((candidate) => candidate.id === selection.id);
    if (edge) return edgePanel(doc, edge, context.send);
  }
  if (selection?.kind === "state") {
    const state = machine.states.find((candidate) => candidate.id === selection.id);
    if (state) return statePanel(doc, state, { machine, select: context.select });
  }
  return html(doc, "p", { class: "muted" }, ["Click a state or an arrow in the diagram."]);
}
