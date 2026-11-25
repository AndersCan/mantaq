import { arrowClick, arrowSend, updateBlocked } from "./arrow-send.ts";
import type { ArrowClick, ArrowSendContext } from "./arrow-send.ts";
import { arrowMembersOf, realMachineOf } from "../groups/fold-groups.ts";
import type { GraphCallbacks, Selection } from "../graph.ts";
import { memberHere } from "../explore.ts";
import { movesFrom } from "../../moves.ts";
import { shareArrows } from "../shared.ts";
import type { Shared } from "../shared.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { currentsOf } from "../compartments.ts";
import type { EventClick } from "./event-send.ts";
import type { Focus } from "./focus.ts";

/** Diagram only: the line under the board says why the selected arrow sends nothing now; empty just after it moved the walk away. */
export function sayWhy(root: HTMLElement, from: ArrowSendContext): void {
  const { selection, sent } = from.view;
  const edge = from.machine.edges.find(
    (candidate) => selection?.kind === "edge" && candidate.id === selection.id,
  );
  const line = root.querySelector(".viz-main > .blocked-note");
  if (line !== null) line.textContent = edge === undefined ? "" : whyText(from, { edge, sent });
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
  shown: VizMachine;
  walk: Focus["walk"];
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
        walk: handlers.walk,
        id: clicked.id,
      });
      if (edge === undefined || click.kind !== "send") return;
      view.selection = selection;
      handlers.sendEvent({ event: edge.event, actor: click.actor, edge: edge.id });
    },
  };
  if (view.diagramOnly) return callbacks;
  callbacks.details = (id) => {
    const drawn: Selection = { kind: "edge", id };
    handlers.openDetails(handlers.walk === "static" ? drawn : memberSelection(drawn, members));
  };
  return callbacks;
}

export interface DrawnArrowOptions {
  /** The machine the canvas draws. */
  shown: VizMachine;
  /** Static: a machine drawn without the walk, whose arrows send nothing. */
  walk: Focus["walk"];
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

/** Why an arrow of an entered machine sends nothing: the walk runs only at the root. */
const STATIC_WHY =
  "This machine is shown without the walk, so its arrows send nothing. Go back to send events.";

/** The one answer the marks and a click share for a drawn arrow. */
export function drawnArrowClick(
  from: ArrowSendContext,
  options: DrawnArrowOptions,
): DrawnArrowClick {
  const { view, machine } = from;
  if (options.walk === "static") {
    const selection: Selection = { kind: "edge", id: options.id };
    const why = view.live === null ? undefined : STATIC_WHY;
    return { selection, edge: undefined, click: { kind: "plain", why } };
  }
  updateBlocked(view, { machine, driver: from.driver });
  const selection = memberSelection(
    { kind: "edge", id: options.id },
    { machine: options.shown, view },
  );
  const edge = machine.edges.find((candidate) => candidate.id === selection.id);
  if (edge === undefined) return { selection, edge, click: { kind: "plain", why: undefined } };
  return { selection, edge, click: arrowClick(from, edge) };
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

interface ArrowQuery {
  id: string;
}

/** The real edge ids a drawn arrow stands for: a shared arrow's members, each group arrow among them by its own real members. */
function realMembers(machine: VizMachine, options: ArrowQuery): string[] {
  const { id } = options;
  const arrow = sharedArrows(machine).arrows.find((each) => each.id === id);
  const drawn = arrow === undefined ? [id] : arrow.members.map((member) => member.id);
  const real: string[] = [];
  for (const each of drawn) {
    const found = arrowMembersOf(machine, { arrow: each });
    real.push(...(found.length === 0 ? [each] : found.map((member) => member.id)));
  }
  return real;
}

/** A shared or group arrow acts as its real member that leaves the current state; with none, it is its own Details. */
export function memberSelection(selection: Selection, options: MemberOptions): Selection {
  const { machine, view } = options;
  if (selection.kind !== "edge" || view.live === null) return selection;
  const walked = realMachineOf(machine);
  const currents = currentsOf(view.live, view.picked);
  const moves = currents.flatMap((current) => movesFrom(walked, current));
  const members = realMembers(machine, { id: selection.id });
  const sources = new Map(walked.edges.map((edge) => [edge.id, edge.from]));
  const member =
    memberHere(members, { moves, blocked: view.blocked }) ??
    members.find((each) => currents.includes(sources.get(each) ?? ""));
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
  view.selection = null;
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
