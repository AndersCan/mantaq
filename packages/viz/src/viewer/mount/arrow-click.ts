import { actingMemberOf, realMembersOf } from "../groups/acting-member.ts";
import { arrowClick, updateBlocked } from "./arrow-send.ts";
import type { ArrowClick, ArrowSendContext } from "./arrow-send.ts";
import type { GraphCallbacks, Selection } from "../graph.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { affordance } from "../dom.ts";
import type { EventClick } from "./event-send.ts";
import { outcomeText } from "../explore.ts";
import { sharedArrowsOf } from "../shared.ts";
import { whyNoneHere } from "../blocked.ts";

export interface SayWhyOptions {
  from: ArrowSendContext;
  /** The machine the canvas draws. */
  shown: VizMachine;
}

/** Diagram only: the line under the board says what the send of the selected arrow did, by its step number, and why the arrow sends nothing now; empty when there is neither. */
export function sayWhy(root: HTMLElement, options: SayWhyOptions): void {
  const { from } = options;
  const { selection, sent } = from.view;
  const line = root.querySelector(".viz-main > .blocked-note");
  if (line === null) return;
  if (selection?.kind !== "edge") {
    line.replaceChildren();
    return;
  }
  const { edge, click } = drawnArrowClick(from, { shown: options.shown, id: selection.id });
  const justSent = edge !== undefined && sent?.edge === edge.id;
  const step = justSent ? stepLine(root.ownerDocument, from) : [];
  const why = justSent ? from.view.blocked.get(edge.id) : whyOf(click);
  const gap = step.length > 0 && why !== undefined ? ". " : "";
  line.replaceChildren(...step, gap, why ?? "");
}

/** What the newest step did: `Step 3: take: stayed in cart`. The number tells one send from the next. A handler that threw: the line adds what it threw, in the words Details use. */
function stepLine(doc: Document, from: ArrowSendContext): Array<Node | string> {
  const { live } = from.view;
  const last = live?.last;
  if (!live || !last) return [];
  const number = live.steps.length;
  const took = from.view.lasts.at(-1) === last;
  const lead = took ? `Step ${number}: ` : "Not sent: ";
  const step = [lead, ...outcomeText(doc, from.machine, last)];
  return last.error ? [...step, `. It threw: ${last.error}`] : step;
}

/** Why a click on an arrow sends nothing: the one reason text the hover title, the line under the board and its `?` share. */
export function whyOf(click: ArrowClick): string | undefined {
  return click.kind === "plain" ? click.why : undefined;
}

/** Why a click on the drawn arrow sends nothing now: the panel's line under an arrow's title. */
export function drawnWhy(from: ArrowSendContext, options: DrawnArrowOptions): string | undefined {
  return whyOf(drawnArrowClick(from, options).click);
}

export interface DrawHandlers {
  root: HTMLElement;
  shown: VizMachine;
  openDetails: (selection: Selection) => void;
  sendEvent: (click: EventClick) => void;
}

/** A click on an arrow sends its event; the diagram marks make only such an arrow a button. A click on a state, and an arrow's `?`, open Details; without a panel, the `?` of an arrow that sends nothing puts why in the line under the board. */
export function drawCallbacks(from: ArrowSendContext, handlers: DrawHandlers): GraphCallbacks {
  const { view } = from;
  const members = { machine: handlers.shown, view };
  return {
    select: (clicked) => {
      if (clicked.kind === "state") return handlers.openDetails(clicked);
      const { selection, edge, click } = drawnArrowClick(from, {
        shown: handlers.shown,
        id: clicked.id,
      });
      if (edge === undefined || click.kind !== "send") return;
      view.selection = selection;
      handlers.sendEvent({ event: edge.event, actor: click.actor, edge: edge.id });
      focusOnAfterSend(handlers.root, { arrow: clicked.id });
    },
    details: (id) => {
      if (view.diagramOnly) view.sent = undefined;
      handlers.openDetails(memberSelection({ kind: "edge", id }, members));
    },
  };
}

interface SentArrow {
  /** The `data-edge-id` of the drawn arrow sent. */
  arrow: string;
}

/** Keyboard traversal goes on after a send: an arrow that had focus and sends nothing now hands it to the first arrow that sends, else to the node of the current state. */
function focusOnAfterSend(root: HTMLElement, options: SentArrow): void {
  const arrow = root.querySelector(`.graph g.edge[data-edge-id="${CSS.escape(options.arrow)}"]`);
  const focused = arrow !== null && root.ownerDocument.activeElement === arrow;
  if (!focused || arrow.getAttribute("role") === "button") return;
  const next =
    root.querySelector<SVGGElement>('.graph g.edge[role="button"]') ??
    root.querySelector<SVGGElement>(".graph g.state.current[data-node-id]");
  if (next === null) return;
  // A plain node takes focus only with a tabindex; -1 keeps it out of the tab order.
  if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
  next.focus({ preventScroll: true });
  affordance(arrow, "plain");
}

export interface DrawnArrowOptions {
  /** The machine the canvas draws. */
  shown: VizMachine;
  /** The `data-edge-id` of the drawn arrow. */
  id: string;
}

/** What a click on a drawn arrow does now: a shared arrow acts as its member at the current state. */
export interface DrawnArrowClick {
  selection: Selection;
  /** The arrow of the walked machine the click is for; undefined when none is. */
  edge: VizEdge | undefined;
  click: ArrowClick;
}

/** The one answer the marks and a click share for a drawn arrow. */
export function drawnArrowClick(
  from: ArrowSendContext,
  options: DrawnArrowOptions,
): DrawnArrowClick {
  const { view, machine } = from;
  updateBlocked(view, { machine, driver: from.driver });
  const selection = memberSelection(
    { kind: "edge", id: options.id },
    { machine: options.shown, view },
  );
  const edge = machine.edges.find((candidate) => candidate.id === selection.id);
  if (edge !== undefined) return { selection, edge, click: arrowClick(from, edge) };
  const ids = realMembersOf(options.shown, {
    shared: sharedArrowsOf(options.shown),
    arrow: options.id,
  });
  const members = machine.edges.filter((candidate) => ids.includes(candidate.id));
  return { selection, edge, click: { kind: "plain", why: membersWhy(from, { members }) } };
}

interface MembersWhyOptions {
  /** The real edges one drawn arrow stands for. */
  members: ReadonlyArray<VizEdge>;
}

/** Why a click on a drawn arrow sends none of its real edges: the walk is elsewhere; undefined with no walk. */
function membersWhy(from: ArrowSendContext, options: MembersWhyOptions): string | undefined {
  const { machine, view } = from;
  if (view.live === null) return undefined;
  return whyNoneHere(machine, { edges: options.members, live: view.live, picked: view.picked });
}

interface MemberOptions {
  machine: VizMachine;
  view: ViewState;
}

/** A shared or group arrow acts as its real member that leaves the current state; with none, it is its own Details. */
export function memberSelection(selection: Selection, options: MemberOptions): Selection {
  const { machine, view } = options;
  if (selection.kind !== "edge") return selection;
  const member = actingMemberOf(machine, { walk: view, arrow: selection.id });
  return member === undefined ? selection : { kind: "edge", id: member };
}

/** Following a child clears the selection and shows the Step tab; while that is how the view stands, the followed child is the current choice. */
export function followedLook(view: ViewState): "current" | "button" {
  const stepShown = view.diagramOnly || view.tab === "step";
  return view.selection === undefined && stepShown ? "current" : "button";
}

export interface PickChildOptions {
  root: HTMLElement;
  view: ViewState;
  refresh: () => void;
  source: "row" | "chip";
}

/** Shows a child machine's own states; from its row, focus returns to the row. */
export function pickChild(child: PickedChild, options: PickChildOptions): void {
  const { root, view } = options;
  view.picked = child;
  view.selection = undefined;
  view.tab = "step";
  options.refresh();
  if (options.source !== "row") return;
  [...root.querySelectorAll<HTMLElement>("li.explore-child")]
    .find(
      (row) =>
        row.getAttribute("data-child-map") === child.map &&
        row.getAttribute("data-child-key") === child.key,
    )
    ?.focus({ preventScroll: true });
}
