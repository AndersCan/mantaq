import { actingMember, realMembersOf } from "../groups/acting-member.ts";
import { affordance } from "../dom.ts";
import { arrowClick, arrowSend, updateBlocked } from "./arrow-send.ts";
import { whyNoneHere } from "../blocked.ts";
import type { ArrowClick, ArrowSendContext } from "./arrow-send.ts";
import { realMachineOf } from "../groups/fold-groups.ts";
import type { GraphCallbacks, Selection } from "../graph.ts";
import { movesFrom } from "../../moves.ts";
import { shareArrows } from "../shared.ts";
import type { Shared } from "../shared.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { currentsOf } from "../compartments.ts";
import type { EventClick } from "./event-send.ts";
import { outcomeText } from "../explore.ts";

/** Diagram only: the line under the board says what the send of the selected arrow did, by its step number, and why the arrow sends nothing now; empty when there is neither. */
export function sayWhy(root: HTMLElement, from: ArrowSendContext): void {
  const { selection, sent } = from.view;
  const edge = from.machine.edges.find(
    (candidate) => selection?.kind === "edge" && candidate.id === selection.id,
  );
  const line = root.querySelector(".viz-main > .blocked-note");
  if (line === null) return;
  if (edge === undefined) {
    line.replaceChildren();
    return;
  }
  const why = whyText(from, { edge, sent });
  const step = sent?.edge === edge.id ? stepLine(root.ownerDocument, from) : [];
  const gap = step.length > 0 && why !== "" ? ". " : "";
  line.replaceChildren(...step, gap, why);
}

/** What the newest step did: `Step 3: take: stayed in cart`. The number tells one send from the next. */
function stepLine(doc: Document, from: ArrowSendContext): Array<Node | string> {
  const { live } = from.view;
  const last = live?.last;
  if (!live || !last) return [];
  const number = live.steps.length;
  return [`Step ${number}: `, ...outcomeText(doc, from.machine, last)];
}

interface WhyTextOptions {
  edge: VizEdge;
  sent: ViewState["sent"];
}

function whyText(from: ArrowSendContext, options: WhyTextOptions): string {
  const { edge, sent } = options;
  const decision = arrowSend(from, edge);
  switch (decision.kind) {
    case "send":
      return decision.blocked ?? "";
    case "refuse":
      return decision.text;
    case "elsewhere":
      return sent?.edge === edge.id ? "" : decision.text;
    case "none":
      return "";
  }
}

export interface DrawHandlers {
  root: HTMLElement;
  shown: VizMachine;
  openDetails: (selection: Selection) => void;
  sendEvent: (click: EventClick) => void;
}

/** A click on an arrow sends its event; the diagram marks make only such an arrow a button. A click on a state, and an arrow's `?`, open Details. */
export function drawCallbacks(from: ArrowSendContext, handlers: DrawHandlers): GraphCallbacks {
  const { view } = from;
  const members = { machine: handlers.shown, view };
  const callbacks: GraphCallbacks = {
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
  };
  if (view.diagramOnly) return callbacks;
  callbacks.details = (id) => {
    handlers.openDetails(memberSelection({ kind: "edge", id }, members));
  };
  return callbacks;
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
    shared: sharedArrows(options.shown),
    arrow: options.id,
  });
  const members = machine.edges.filter((candidate) => ids.includes(candidate.id));
  return { selection, edge, click: { kind: "plain", why: membersWhy(from, { members }) } };
}

export interface MembersWhyOptions {
  /** The real edges one drawn arrow stands for. */
  members: ReadonlyArray<VizEdge>;
}

/** Why a click on a drawn arrow sends none of its real edges: the walk is elsewhere; undefined with no walk. */
export function membersWhy(from: ArrowSendContext, options: MembersWhyOptions): string | undefined {
  const { machine, view } = from;
  if (view.live === null) return undefined;
  return whyNoneHere(machine, { edges: options.members, live: view.live, picked: view.picked });
}

interface MemberOptions {
  machine: VizMachine;
  view: ViewState;
}

/** Shared arrows by machine: the marks ask for each arrow after every step. */
const sharedOf = new WeakMap<VizMachine, Shared>();

function sharedArrows(machine: VizMachine): Shared {
  const known = sharedOf.get(machine);
  if (known !== undefined) return known;
  const shared = shareArrows(machine);
  sharedOf.set(machine, shared);
  return shared;
}

/** A shared or group arrow acts as its real member that leaves the current state; with none, it is its own Details. */
export function memberSelection(selection: Selection, options: MemberOptions): Selection {
  const { machine, view } = options;
  if (selection.kind !== "edge" || view.live === null) return selection;
  const walked = realMachineOf(machine);
  const currents = currentsOf(view.live, view.picked);
  const moves = currents.flatMap((current) => movesFrom(walked, current));
  const members = realMembersOf(machine, { shared: sharedArrows(machine), arrow: selection.id });
  const sources = new Map(walked.edges.map((edge) => [edge.id, edge.from]));
  const member = actingMember(members, { moves, blocked: view.blocked, currents, sources });
  return member === undefined ? selection : { kind: "edge", id: member };
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
