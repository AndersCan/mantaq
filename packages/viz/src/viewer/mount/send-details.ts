import { button, code, elapsed, listOf, outcomeText, sentEventLine } from "../explore.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { arrowSend } from "./arrow-send.ts";
import type { ArrowSendContext } from "./arrow-send.ts";
import type { EventClick } from "./event-send.ts";
import { html } from "../dom.ts";
import type { ViewState } from "./view-state.ts";

export interface SendForContext extends ArrowSendContext {
  root: HTMLElement;
  doc: Document;
}

export interface SendForHandlers {
  sendEvent: (click: EventClick) => void;
}

/** The selected arrow's Send: one button when its source is current; blocked, the reason; no driver, none. */
export function sendFor(
  from: SendForContext,
  handlers: SendForHandlers,
): (edge: VizEdge) => HTMLElement | null {
  const { doc, machine, view } = from;
  function timerLine(edge: VizEdge): HTMLElement | undefined {
    const { live } = view;
    const timer = live?.timers.find((each) => each.eventName === edge.event);
    if (live === null || timer === undefined) return undefined;
    const left = timer.deadline - elapsed(live.steps);
    return html(doc, "p", { "data-timer-line": edge.event }, [
      code(doc, edge.event),
      ` fires on its own in ${left} ms; a click sends it now.`,
    ]);
  }
  function sendOf(edge: VizEdge): HTMLElement | null {
    const decision = arrowSend(from, edge);
    function note(text: string): HTMLElement {
      return html(doc, "p", { class: "blocked-note", "data-blocked-note": edge.event }, [text]);
    }
    function here(sendButton: HTMLElement | null): HTMLElement | null {
      return sentHere(doc, { machine, view, edge, sendButton });
    }
    switch (decision.kind) {
      case "none":
        return here(null);
      case "refuse":
        return note(decision.text);
      case "elsewhere":
        return here(null) ?? note(decision.text);
      case "send": {
        const { actor } = decision;
        const recipient =
          actor !== undefined && "map" in actor ? [" to ", code(doc, actor.key)] : [];
        const sent = here(
          button(doc, ["Send ", code(doc, edge.event), ...recipient], {
            onClick: () => {
              handlers.sendEvent({ event: edge.event, actor, edge: edge.id });
              focusEdge(from.root, { id: edge.id });
            },
            attrs: { "data-send-edge": edge.id },
          }),
        );
        const line = timerLine(edge);
        return line === undefined
          ? sent
          : html(doc, "div", {}, sent === null ? [line] : [line, sent]);
      }
    }
  }
  return sendOf;
}

interface SentHereOptions {
  machine: VizMachine;
  view: ViewState;
  edge: VizEdge;
  sendButton: HTMLElement | null;
}

/** After a Send from this arrow's Details: what was sent and where it went, then the button when it can still be pressed. */
function sentHere(doc: Document, from: SentHereOptions): HTMLElement | null {
  const { view, edge, sendButton } = from;
  const { sent } = view;
  if (sent?.edge !== edge.id) return sendButton;
  const outcome = sentOutcome(doc, { machine: from.machine, view });
  if (outcome === undefined) return sendButton;
  const line = html(doc, "p", { "data-details-sent": "" }, [
    ...sentEventLine(doc, sent),
    ...outcome,
  ]);
  return html(doc, "div", {}, [line, sendButton]);
}

interface SentOutcomeOptions {
  machine: VizMachine;
  view: ViewState;
}

/** Where the last Send went: the driver's outcome. */
function sentOutcome(doc: Document, options: SentOutcomeOptions): Array<Node | string> | undefined {
  const { last } = options.view.live ?? {};
  if (last !== undefined) {
    if (last === null) return undefined;
    const text = outcomeText(doc, options.machine, last);
    // A move's text opens with the event and who ran it, which the sent line already names.
    const tail = last.outcome === "missing" ? [": ", ...text] : [": ", ...text.slice(-1)];
    return last.error === null ? tail : [...tail, `. It threw: ${last.error}`];
  }
  return undefined;
}

interface FocusEdgeOptions {
  id: string;
}

/** The Send button goes once pressed; focus moves to the selected arrow so keyboard users keep their place. */
function focusEdge(root: HTMLElement, options: FocusEdgeOptions): void {
  const { id } = options;
  const edges = [...root.querySelectorAll<SVGElement>("g[data-edge-id]")];
  edges
    .find(
      (each) =>
        each.getAttribute("data-edge-id") === id || listOf(each.dataset["members"])?.includes(id),
    )
    ?.focus({ preventScroll: true });
}
