import { drawnNodeOf } from "../groups/fold-groups.ts";
import { actingMemberOf } from "../groups/acting-member.ts";
import { affordance, svg } from "../dom.ts";
import { drawnArrowClick, followedLook, whyOf } from "./arrow-click.ts";
import type { DrawnArrowClick } from "./arrow-click.ts";
import type { Affordance } from "../dom.ts";
import { drawChildMarkers, drawQueue } from "../markers.ts";
import { listOf, markExplore } from "../explore.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizDriver, VizMachine } from "../../schema.ts";
import { currentsOf } from "../compartments.ts";
import { queueOf } from "../queue.ts";
import type { Selection } from "../graph.ts";
import { updateBlocked } from "./arrow-send.ts";

export interface MarkDiagramContext {
  machine: VizMachine;
  /** The machine the canvas draws: `machine` or one machine of its board, folded, or a group entered. */
  shown: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
  pick: (child: PickedChild) => void;
}

/** Everything drawn over the graph: walk marks, selection, and which states and arrows a click acts on. */
export function markDiagram(root: HTMLElement, context: MarkDiagramContext): void {
  const { machine, view } = context;
  markAffordance(root, context);
  updateBlocked(view, { machine, driver: context.driver });
  function actingOf(arrow: string): string | undefined {
    return actingMemberOf(context.shown, { walk: view, arrow });
  }
  markExplore(root, { machine, blocked: view.blocked, actingOf, ...liveState(view) });
  const graph = root.querySelector<SVGSVGElement>(".graph");
  if (graph !== null && view.live !== null) {
    drawChildMarkers(graph, {
      children: view.live.children,
      picked: view.picked,
      followedLook: followedLook(view),
      onPick: context.pick,
    });
    const state = drawnNodeOf(context.shown, { state: view.live.state });
    drawQueue(graph, { state, queue: queueOf(machine, view.live.context) });
  }
  markSelection(root, { selection: drawnSelection(view.selection, { shown: context.shown }) });
}

interface ShownOptions {
  shown: VizMachine;
}

/** A selected state as drawn: its group node when the canvas folds it into one. */
function drawnSelection(
  selection: Selection | undefined,
  options: ShownOptions,
): Selection | undefined {
  if (selection?.kind !== "state") return selection;
  return { kind: "state", id: drawnNodeOf(options.shown, { state: selection.id }) };
}

/** A state is a button while a click opens its Details in a panel that is shown, and the current choice while they show; an arrow, while a click sends it. Every other arrow says why on hover. A stub's look is its own: it goes back where it can. */
function markAffordance(root: HTMLElement, context: MarkDiagramContext): void {
  const { machine, view, driver, shown } = context;
  for (const state of root.querySelectorAll<SVGGElement>(".graph g.state:not(.stub)")) {
    affordance(state, stateLook(view, { id: state.dataset["nodeId"] ?? "" }));
  }
  for (const arrow of root.querySelectorAll<SVGGElement>(".graph g.edge[data-edge-id]")) {
    const id = arrow.dataset["edgeId"] ?? "";
    const answer = drawnArrowClick({ machine, view, driver }, { shown, id });
    const why = whyOf(answer.click);
    affordance(arrow, answer.click.kind === "send" ? "button" : "plain");
    markWhy(arrow, { why });
    const help = root.querySelector<SVGGElement>(
      `.graph g.edge-help[data-details-edge="${CSS.escape(id)}"]`,
    );
    if (help !== null) markHelp(help, { view, answer, why, arrow });
  }
}

interface HelpOptions {
  view: ViewState;
  answer: DrawnArrowClick;
  why: string | undefined;
  /** The arrow the `?` belongs to; it names the `?`. */
  arrow: SVGGElement;
}

/** An arrow's `?` opens its Details, and is the current choice while they show. Without a panel it is drawn only on an arrow that sends nothing, and puts why in the line under the board; it is the current choice while the line says it. */
function markHelp(help: SVGGElement, options: HelpOptions): void {
  const { view, answer, why } = options;
  const selected = sameSelection(answer.selection, { other: view.selection });
  const arrowName = options.arrow.getAttribute("aria-label") ?? "";
  if (!view.diagramOnly) {
    help.setAttribute("aria-label", `Details of ${arrowName}`);
    affordance(help, view.tab === "details" && selected ? "current" : "button");
    return;
  }
  help.setAttribute("aria-label", `Why ${arrowName} sends nothing`);
  const { edge } = answer;
  const sentNow = edge !== undefined && view.sent?.edge === edge.id;
  if (why === undefined) affordance(help, "plain");
  else affordance(help, selected && !sentNow ? "current" : "button");
}

interface NodeQuery {
  /** The drawn node's id, as `data-node-id` holds it. */
  id: string;
}

/** A state shows its Details on a click, and with a panel that shows them already, or previews its screen, it is the current choice. */
function stateLook(view: ViewState, options: NodeQuery): Affordance {
  if (view.diagramOnly) return "plain";
  const shown = view.tab === "details" || view.tab === "screen";
  const selected = sameSelection(view.selection, { other: { kind: "state", id: options.id } });
  return shown && selected ? "current" : "button";
}

interface SameOptions {
  other: Selection | undefined;
}

function sameSelection(selection: Selection | undefined, options: SameOptions): boolean {
  const { other } = options;
  return selection?.kind === other?.kind && selection?.id === other?.id;
}

interface MarkWhyOptions {
  why: string | undefined;
}

/** The hover title of an arrow a click does not send: why it does not. */
function markWhy(arrow: SVGGElement, options: MarkWhyOptions): void {
  const { why } = options;
  arrow.querySelector(":scope > title.why")?.remove();
  if (why === undefined) return;
  arrow.prepend(svg(arrow.ownerDocument, "title", { class: "why" }, [why]));
}

interface MarkSelectionOptions {
  selection: Selection | undefined;
}

/** The node ids that the arrows holding the selected edge leave from. */
function arrowSources(root: HTMLElement, options: MarkSelectionOptions): Set<string | undefined> {
  const { selection } = options;
  const sources = new Set<string | undefined>();
  if (selection?.kind !== "edge") return sources;
  for (const arrow of root.querySelectorAll<SVGGElement>(".graph g[data-members]")) {
    if (listOf(arrow.dataset["members"])?.includes(selection.id)) {
      sources.add(arrow.dataset["from"]);
    }
  }
  return sources;
}

function markSelection(root: HTMLElement, options: MarkSelectionOptions): void {
  const { selection } = options;
  const attribute = selection?.kind === "edge" ? "edgeId" : "nodeId";
  const arrowNodes = arrowSources(root, options);
  for (const element of root.querySelectorAll<SVGGElement>(".graph g")) {
    const members = listOf(element.dataset["members"]) ?? [];
    element.classList.toggle(
      "selected",
      selection !== undefined &&
        (element.dataset[attribute] === selection.id ||
          (selection.kind === "edge" && members.includes(selection.id)) ||
          (element.classList.contains("any-node") && arrowNodes.has(element.dataset["nodeId"]))),
    );
  }
}

function liveState(view: ViewState): { currents?: string[] } {
  return view.live === null ? {} : { currents: currentsOf(view.live, view.picked) };
}
