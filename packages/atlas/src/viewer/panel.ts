import type { AtlasEdge, AtlasMachine, AtlasState } from "../schema.ts";
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

function joined(values: ReadonlyArray<string>): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function hitsText(coverage: { hits: number } | null): string {
  return coverage === null ? "no run supplied" : String(coverage.hits);
}

function edgeLink(
  doc: Document,
  edge: AtlasEdge,
  select: (selection: Selection) => void,
): HTMLLIElement {
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${edge.from} —${edge.event || "initial"}→ ${edge.to ?? "?"}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

function edgeList(
  doc: Document,
  edges: ReadonlyArray<AtlasEdge>,
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

function edgePanel(doc: Document, edge: AtlasEdge, machine: AtlasMachine): HTMLElement {
  const internal = machine.events.find((event) => event.id === edge.event)?.internal === true;
  return html(doc, "section", { class: "details", "data-selected-edge": edge.id }, [
    html(doc, "h2", {}, [`Edge ${edge.id}`]),
    list(doc, [
      ["source", edge.from],
      [
        "event",
        edge.kind === "initial" ? "(initial)" : `${edge.event}${internal ? " (internal)" : ""}`,
      ],
      ["target", edge.to ?? "undetermined"],
      ["kind", edge.kind],
      ["emits", joined(edge.emits)],
      ["contexts", joined(edge.contexts)],
      ["hits", hitsText(edge.coverage)],
      ["explanation", "not analyzed"],
    ]),
  ]);
}

function statePanel(
  doc: Document,
  state: AtlasState,
  context: { machine: AtlasMachine; select: (selection: Selection) => void },
): HTMLElement {
  const { machine, select } = context;
  const flags = [state.initial ? "initial" : "", state.final ? "final" : ""].filter(Boolean);
  const outgoing = machine.edges.filter((edge) => edge.from === state.id);
  const incoming = machine.edges.filter((edge) => edge.to === state.id && edge.kind !== "initial");
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${state.id}`]),
    list(doc, [
      ["id", state.id],
      ["region", state.region ?? "(root)"],
      ["flags", joined(flags)],
      ["visits", hitsText(state.coverage)],
      ["outgoing", edgeList(doc, outgoing, select)],
      ["incoming", edgeList(doc, incoming, select)],
    ]),
  ]);
}

/** Side-panel body for the current selection, or a hint when nothing is selected. */
export function renderPanel(
  doc: Document,
  machine: AtlasMachine,
  context: { selection: Selection | null; select: (selection: Selection) => void },
): HTMLElement {
  const { selection } = context;
  if (selection?.kind === "edge") {
    const edge = machine.edges.find((candidate) => candidate.id === selection.id);
    if (edge) return edgePanel(doc, edge, machine);
  }
  if (selection?.kind === "state") {
    const state = machine.states.find((candidate) => candidate.id === selection.id);
    if (state) return statePanel(doc, state, { machine, select: context.select });
  }
  return html(doc, "p", { class: "hint" }, ["Select a state or edge."]);
}
