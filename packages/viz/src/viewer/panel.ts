import { coveredByAny, isAnyState } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { localName } from "./compartments.ts";
import { activatable, html } from "./dom.ts";
import type { Selection } from "./graph.ts";
import { edgeCondition } from "./labels.ts";
import { isDrawn } from "./layout.ts";
import { shareArrows } from "./shared.ts";
import type { SharedArrow } from "./shared.ts";

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
  withCondition: boolean,
): HTMLLIElement {
  const condition = withCondition ? edgeCondition(edge) : null;
  const when = condition === null ? "" : ` [${condition}]`;
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${sourceText(edge.from)} —${edge.event}${when}→ ${edge.to ?? "?"}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

function edgeList(
  doc: Document,
  edges: ReadonlyArray<VizEdge>,
  select: (selection: Selection) => void,
  withCondition: boolean,
): Node | string {
  if (edges.length === 0) return "none";
  return html(
    doc,
    "ul",
    {},
    edges.map((edge) => edgeLink(doc, edge, select, withCondition)),
  );
}

/** `idle —apply [score < 600]→ rejected`: the edge as the diagram draws it, with its condition. */
function edgeTitle(edge: VizEdge): string {
  const from = isAnyState(edge.from) ? "any state" : localName(edge.from);
  const to = edge.to === null ? "?" : localName(edge.to);
  const condition = edgeCondition(edge);
  const when = condition === null ? "" : ` [${condition}]`;
  return `${from} —${edge.event}${when}→ ${to}`;
}

/** The other arrows of this edge's event from the same state, in the order the code branches. */
function sameEvent(machine: VizMachine, edge: VizEdge): VizEdge[] {
  if (edgeCondition(edge) === null) return [];
  const branches = edge.explanation?.status === "analyzed" ? edge.explanation.branches : [];
  const rank = (other: VizEdge): number => {
    const index = branches.findIndex(
      (branch) =>
        branch.target.kind === "state" && branch.target.state === localName(other.to ?? ""),
    );
    return index === -1 ? branches.length : index;
  };
  return machine.edges
    .filter(
      (other) =>
        other.id !== edge.id &&
        other.kind === "transition" &&
        other.from === edge.from &&
        other.event === edge.event,
    )
    .sort((a, b) => rank(a) - rank(b) || (a.to ?? "").localeCompare(b.to ?? ""));
}

function docLine(doc: Document, scope: string, text: string | null): HTMLElement | null {
  return text === null ? null : html(doc, "p", { class: "doc", "data-doc": scope }, [text]);
}

interface EdgePanelOptions {
  edge: VizEdge;
  machine: VizMachine;
  select: (selection: Selection) => void;
  send: ((edge: VizEdge) => HTMLElement | undefined) | undefined;
}

function edgePanel(doc: Document, options: EdgePanelOptions): HTMLElement {
  const { edge, machine, select, send } = options;
  const siblings = sameEvent(machine, edge);
  return html(doc, "section", { class: "details", "data-selected-edge": edge.id }, [
    html(doc, "h2", {}, [edgeTitle(edge)]),
    send?.(edge) ?? null,
    docLine(doc, "edge", edge.doc),
    siblings.length === 0
      ? null
      : list(doc, [["same event", edgeList(doc, siblings, select, true)]]),
  ]);
}

/** One arrow several states share: the states, each a link to its own arrow. */
function sharedPanel(
  doc: Document,
  arrow: SharedArrow,
  select: (selection: Selection) => void,
): HTMLElement {
  const { drawn, members } = arrow;
  const to = drawn.to === null ? "?" : localName(drawn.to);
  const condition = edgeCondition(drawn);
  const when = condition === null ? "" : ` [${condition}]`;
  return html(doc, "section", { class: "details", "data-selected-edge": arrow.id }, [
    html(doc, "h2", {}, [`${members.length} states —${arrow.event}${when}→ ${to}`]),
    edgeList(doc, members, select, false),
    docLine(doc, "edge", members[0]?.doc ?? null),
  ]);
}

function statePanel(
  doc: Document,
  state: VizState,
  context: { machine: VizMachine; select: (selection: Selection) => void },
): HTMLElement {
  const { machine, select } = context;
  const outgoing = machine.edges.filter(
    (edge) =>
      isDrawn(edge) &&
      (edge.from === state.id || (!state.final && coveredByAny(edge.from, state.id))),
  );
  const incoming = machine.edges.filter((edge) => isDrawn(edge) && edge.to === state.id);
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${state.id}`]),
    docLine(doc, "state", state.doc),
    list(doc, [
      ["outgoing", edgeList(doc, outgoing, select, false)],
      ["incoming", edgeList(doc, incoming, select, false)],
    ]),
  ]);
}

export interface RenderPanelOptions {
  machine: VizMachine;
  selection: Selection | null;
  select: (selection: Selection) => void;
  /** What Details shows under an arrow's title to send it. */
  send?: (edge: VizEdge) => HTMLElement | undefined;
  /** Shown when nothing is selected. */
  hint?: string;
}

function selectedPanel(doc: Document, options: RenderPanelOptions): HTMLElement | undefined {
  const { machine, selection, select } = options;
  const id = selection?.id;
  switch (selection?.kind) {
    case "edge": {
      const edge = machine.edges.find((candidate) => candidate.id === id);
      if (edge) return edgePanel(doc, { edge, machine, select, send: options.send });
      const arrow = shareArrows(machine).arrows.find((candidate) => candidate.id === id);
      return arrow && sharedPanel(doc, arrow, select);
    }
    case "state": {
      const state = machine.states.find((candidate) => candidate.id === id);
      return state && statePanel(doc, state, { machine, select });
    }
    case undefined:
      return undefined;
  }
}

/** Side-panel body for the current selection, or a hint when nothing is selected. */
export function renderPanel(doc: Document, options: RenderPanelOptions): HTMLElement {
  return (
    selectedPanel(doc, options) ??
    html(doc, "p", { class: "muted" }, [
      options.hint ?? "Click a state or an arrow in the diagram.",
    ])
  );
}
