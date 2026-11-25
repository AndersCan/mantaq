import { arrowSend, currentsFor } from "./arrow-send.ts";
import type { GraphCallbacks, Selection } from "../graph.ts";
import { memberAt, shareArrows } from "../shared.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import type { ArrowSendContext } from "./arrow-send.ts";
import type { EventClick } from "./event-send.ts";
import { staticCallbacks } from "./canvas.ts";

/** Diagram only: the line under the board says why the selected arrow's click did not, or will not, go where it is drawn. */
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
      return sent?.edge === edge.id ? (sent.blocked ?? "") : (decision.blocked ?? "");
    case "refuse":
      return decision.text;
    case "elsewhere":
      return sent?.edge === edge.id ? "" : decision.text;
    case "none":
      return "";
  }
}

interface DrawHandlers {
  shown: VizMachine;
  openDetails: (selection: Selection) => void;
  sendEvent: (click: EventClick) => void;
}

/** A click on an arrow sends its event when a person can send it from here, blocked or not; else it opens the arrow's Details, which say why not. Its `?` opens Details. */
function drawCallbacks(from: ArrowSendContext, handlers: DrawHandlers): GraphCallbacks {
  const { machine, view } = from;
  const members = { machine: handlers.shown, currents: currentsFor(from) };
  return {
    select: (clicked) => {
      const selection = memberSelection(clicked, members);
      const edge = machine.edges.find(
        (candidate) => selection.kind === "edge" && candidate.id === selection.id,
      );
      const decision = edge && arrowSend(from, edge);
      if (edge === undefined || decision?.kind !== "send") {
        if (edge !== undefined) view.sent = undefined;
        return handlers.openDetails(selection);
      }
      view.selection = selection;
      handlers.sendEvent({ event: edge.event, actor: decision.actor, edge: edge.id });
    },
    ...(view.diagramOnly
      ? {}
      : {
          details: (id: string) =>
            handlers.openDetails(memberSelection({ kind: "edge", id }, members)),
        }),
  };
}

interface MemberOptions {
  machine: VizMachine;
  currents: string[];
}

/** A shared arrow acts as the member of the current state; with none, it is its own Details. */
function memberSelection(selection: Selection, options: MemberOptions): Selection {
  const { machine, currents } = options;
  const arrow = shareArrows(machine).arrows.find(
    (each) => selection.kind === "edge" && each.id === selection.id,
  );
  const member = arrow && currents.length > 0 && memberAt(arrow, currents);
  return member ? { kind: "edge", id: member.id } : selection;
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

export interface ClickCallbacksOptions {
  /** Where clicks send from now; undefined while the entered machine is drawn without its state. */
  arrows: () => ArrowSendContext | undefined;
  view: ViewState;
  shown: () => VizMachine;
  openDetails: (selection: Selection) => void;
  sendEvent: (click: EventClick) => void;
}

/** The canvas callbacks, worked out at each click: a step can stop or start the entered machine while the canvas stays. */
export function clickCallbacks(options: ClickCallbacksOptions): GraphCallbacks {
  const { arrows, view, openDetails } = options;
  function now(): GraphCallbacks {
    const sender = arrows();
    if (sender === undefined) return staticCallbacks(view, { openDetails });
    return drawCallbacks(sender, {
      shown: options.shown(),
      openDetails,
      sendEvent: options.sendEvent,
    });
  }
  function select(clicked: Selection): void {
    now().select(clicked);
  }
  if (view.diagramOnly) return { select };
  return { select, details: (id) => now().details?.(id) };
}
