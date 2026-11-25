import { coveredByAny } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { localName } from "./compartments.ts";
import { activatable, html } from "./dom.ts";
import type { Selection } from "./graph.ts";
import { edgeCondition } from "./labels.ts";
import { isDrawn } from "./layout.ts";
import { drawnNodeName, groupArrowsOf, groupNodeAt, realMachineOf } from "./groups/fold-groups.ts";
import type { GroupArrow, GroupNode } from "./groups/fold-groups.ts";
import { realMembersOf } from "./groups/acting-member.ts";
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

interface EdgeListOptions {
  /** The machine the edges are drawn in, so each end reads as the canvas names it. */
  machine: VizMachine;
  select: (selection: Selection) => void;
  /** Whether each link shows its edge's condition, which tells apart the edges of one event. */
  conditions: "shown" | "hidden";
}

interface EdgeLinkOptions extends EdgeListOptions {
  edge: VizEdge;
}

function edgeLink(doc: Document, options: EdgeLinkOptions): HTMLLIElement {
  const { edge, machine, select } = options;
  const condition = options.conditions === "shown" ? edgeCondition(edge) : undefined;
  const when = typeof condition === "string" ? ` [${condition}]` : "";
  const from = drawnNodeName(machine, { node: edge.from });
  const target = typeof edge.to === "string" ? drawnNodeName(machine, { node: edge.to }) : "?";
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${from} —${edge.event}${when}→ ${target}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

interface EdgesOptions extends EdgeListOptions {
  edges: ReadonlyArray<VizEdge>;
}

function edgeList(doc: Document, options: EdgesOptions): Node | string {
  const { edges } = options;
  if (edges.length === 0) return "none";
  const links: HTMLLIElement[] = [];
  for (const edge of edges) links.push(edgeLink(doc, { ...options, edge }));
  return html(doc, "ul", {}, links);
}

interface DrawnIn {
  /** The machine the edge is drawn in. */
  machine: VizMachine;
}

/** `idle —apply [score < 600]→ rejected`: the edge as the diagram draws it, with its condition. */
function edgeTitle(edge: VizEdge, options: DrawnIn): string {
  const { machine } = options;
  const from = drawnNodeName(machine, { node: edge.from });
  const target = typeof edge.to === "string" ? drawnNodeName(machine, { node: edge.to }) : "?";
  const condition = edgeCondition(edge);
  const when = condition === null ? "" : ` [${condition}]`;
  return `${from} —${edge.event}${when}→ ${target}`;
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
    html(doc, "h2", {}, [edgeTitle(edge, { machine })]),
    send?.(edge) ?? null,
    docLine(doc, "edge", edge.doc),
    siblings.length === 0
      ? null
      : list(doc, [
          ["same event", edgeList(doc, { edges: siblings, machine, select, conditions: "shown" })],
        ]),
  ]);
}

interface SharedPanelOptions {
  arrow: SharedArrow;
  /** The drawn machine the arrow is shared in. */
  machine: VizMachine;
  select: (selection: Selection) => void;
}

/** One arrow several states share: the states, each a link to its own arrow. */
function sharedPanel(doc: Document, options: SharedPanelOptions): HTMLElement {
  const { arrow, machine, select } = options;
  const { drawn, members } = arrow;
  const target = typeof drawn.to === "string" ? drawnNodeName(machine, { node: drawn.to }) : "?";
  const condition = edgeCondition(drawn);
  const when = condition === null ? "" : ` [${condition}]`;
  const title = `${members.length} states —${arrow.event}${when}→ ${target}`;
  return html(doc, "section", { class: "details", "data-selected-edge": arrow.id }, [
    html(doc, "h2", {}, [title]),
    edgeList(doc, { edges: members, machine, select, conditions: "hidden" }),
    docLine(doc, "edge", members[0]?.doc ?? null),
  ]);
}

interface GroupArrowOptions {
  arrow: GroupArrow;
  machine: VizMachine;
  select: (selection: Selection) => void;
}

/** One arrow that stands for several real edges across a group's edge: each real edge with its condition, a link to its own Details. */
function groupArrowPanel(doc: Document, options: GroupArrowOptions): HTMLElement {
  const { arrow, machine, select } = options;
  const { drawn, members } = arrow;
  const from = drawnNodeName(machine, { node: drawn.from });
  const target = typeof drawn.to === "string" ? drawnNodeName(machine, { node: drawn.to }) : "?";
  const title = `${from} —${drawn.event}→ ${target}`;
  const edges = edgeList(doc, { edges: members, machine, select, conditions: "shown" });
  return html(doc, "section", { class: "details", "data-selected-edge": arrow.id }, [
    html(doc, "h2", {}, [title]),
    list(doc, [["edges", edges]]),
  ]);
}

interface GroupPanelOptions {
  node: GroupNode;
  machine: VizMachine;
  select: (selection: Selection) => void;
}

/** Where a drawn arrow runs relative to a group node: out of it, into it, or a loop on it, which is a move between its own states. */
type GroupSide = "outgoing" | "incoming" | "inside";

interface SideOptions {
  node: string;
}

function sideOf(edge: VizEdge, options: SideOptions): GroupSide | undefined {
  const { node } = options;
  const leaves = edge.from === node;
  const reaches = edge.to === node;
  if (leaves && reaches) return "inside";
  if (leaves) return "outgoing";
  return reaches ? "incoming" : undefined;
}

/** A group folded into one node: its states, each a link to its own Details, and the arrows drawn out, in and inside it, each once. */
function groupPanel(doc: Document, options: GroupPanelOptions): HTMLElement {
  const { node, machine, select } = options;
  const links: HTMLLIElement[] = [];
  for (const id of node.states) {
    const name = drawnNodeName(machine, { node: id });
    const link = html(doc, "span", { class: "link", "data-state-link": id }, [name]);
    activatable(link, () => select({ kind: "state", id }));
    links.push(html(doc, "li", {}, [link]));
  }
  const sides = new Map<GroupSide, VizEdge[]>();
  for (const edge of machine.edges) {
    const side = isDrawn(edge) ? sideOf(edge, { node: node.id }) : undefined;
    if (side !== undefined) sides.set(side, [...(sides.get(side) ?? []), edge]);
  }
  function edgesOn(side: GroupSide): Node | string {
    const edges = sides.get(side) ?? [];
    return edgeList(doc, { edges, machine, select, conditions: "hidden" });
  }
  const inside: Row[] = sides.has("inside") ? [["inside", edgesOn("inside")]] : [];
  return html(doc, "section", { class: "details", "data-selected-state": node.id }, [
    html(doc, "h2", {}, [`Group ${node.name}`]),
    list(doc, [
      ["states", html(doc, "ul", {}, links)],
      ["outgoing", edgesOn("outgoing")],
      ["incoming", edgesOn("incoming")],
      ...inside,
    ]),
  ]);
}

interface StatePanelOptions {
  state: VizState;
  machine: VizMachine;
  select: (selection: Selection) => void;
}

function statePanel(doc: Document, options: StatePanelOptions): HTMLElement {
  const { state, machine, select } = options;
  const outgoing = machine.edges.filter(
    (edge) =>
      isDrawn(edge) &&
      (edge.from === state.id || (!state.final && coveredByAny(edge.from, state.id))),
  );
  const incoming = machine.edges.filter((edge) => isDrawn(edge) && edge.to === state.id);
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${drawnNodeName(machine, { node: state.id })}`]),
    docLine(doc, "state", state.doc),
    list(doc, [
      ["outgoing", edgeList(doc, { edges: outgoing, machine, select, conditions: "hidden" })],
      ["incoming", edgeList(doc, { edges: incoming, machine, select, conditions: "hidden" })],
    ]),
  ]);
}

export interface RenderPanelOptions {
  machine: VizMachine;
  selection: Selection | undefined;
  select: (selection: Selection) => void;
  /** What Details shows under an arrow's title to send it. */
  send?: (edge: VizEdge) => HTMLElement | undefined;
  /** Why the walk sends none of a drawn arrow's real edges now; undefined when it can, or without a walk. */
  why?: (members: ReadonlyArray<VizEdge>) => string | undefined;
  /** Shown when nothing is selected. */
  hint?: string;
}

interface WhyLineOptions extends RenderPanelOptions {
  real: VizMachine;
  /** The drawn arrow's id. */
  arrow: string;
}

/** The line under a drawn arrow's title that says why a click sends none of its real edges; undefined when one can be sent. */
function whyLine(doc: Document, options: WhyLineOptions): HTMLElement | undefined {
  const { machine, real, arrow, why } = options;
  const ids = realMembersOf(machine, { shared: shareArrows(machine), arrow });
  const members = real.edges.filter((edge) => ids.includes(edge.id));
  const text = why?.(members);
  if (text === undefined) return undefined;
  const event = members[0]?.event ?? "";
  return html(doc, "p", { class: "blocked-note", "data-blocked-note": event }, [text]);
}

interface LineOptions {
  /** Shown under the title; nothing when undefined. */
  line: HTMLElement | undefined;
}

/** A panel with a line under its title. */
function withLine(panel: HTMLElement, options: LineOptions): HTMLElement {
  const { line } = options;
  if (line !== undefined) panel.querySelector("h2")?.after(line);
  return panel;
}

/** The panel of a selection on the drawn machine: a real edge or state reads the real machine, a group node or arrow its fold. */
function selectedPanel(doc: Document, options: RenderPanelOptions): HTMLElement | undefined {
  const { machine, selection, select } = options;
  const real = realMachineOf(machine);
  const id = selection?.id;
  switch (selection?.kind) {
    case "edge": {
      const edge = real.edges.find((candidate) => candidate.id === id);
      if (edge) return edgePanel(doc, { edge, machine: real, select, send: options.send });
      const grouped = groupArrowsOf(machine).find((candidate) => candidate.id === id);
      const line = whyLine(doc, { ...options, real, arrow: selection.id });
      if (grouped) {
        return withLine(groupArrowPanel(doc, { arrow: grouped, machine, select }), { line });
      }
      const arrow = shareArrows(machine).arrows.find((candidate) => candidate.id === id);
      return arrow && withLine(sharedPanel(doc, { arrow, machine, select }), { line });
    }
    case "state": {
      const state = real.states.find((candidate) => candidate.id === id);
      if (state) return statePanel(doc, { state, machine: real, select });
      const node = groupNodeAt(machine, { node: selection.id });
      return node && groupPanel(doc, { node, machine, select });
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
