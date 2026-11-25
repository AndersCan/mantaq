import { code, elapsed, listOf, outcomeText, sentEventLine } from "../explore.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { arrowSend } from "./arrow-send.ts";
import type { ArrowSendContext } from "./arrow-send.ts";
import type { EventClick } from "./event-send.ts";
import { html } from "../dom.ts";
import type { PayloadEdit } from "../send/payloads.ts";
import { sendForm } from "../send/send-form.ts";
import type { ViewState } from "./view-state.ts";

export interface SendForContext extends ArrowSendContext {
  root: HTMLElement;
  doc: Document;
}

export interface SendForHandlers {
  sendEvent: (click: EventClick) => void;
  /** A field of the send form changed. */
  edit: (edit: PayloadEdit) => void;
}

/** The selected arrow's send form when it leaves the walk's state (with the lock reason when blocked); else why it cannot be sent; no driver, none. */
export function sendFor(
  from: SendForContext,
  handlers: SendForHandlers,
): (edge: VizEdge) => HTMLElement | undefined {
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
  function sendOf(edge: VizEdge): HTMLElement | undefined {
    const decision = arrowSend(from, edge);
    function note(text: string): HTMLElement {
      return html(doc, "p", { class: "blocked-note", "data-blocked-note": edge.event }, [text]);
    }
    const sent = sentHere(doc, { machine, view, edge });
    switch (decision.kind) {
      case "none":
        return sent;
      case "refuse":
        return note(decision.text);
      case "elsewhere":
        return sent ?? note(decision.text);
      case "send": {
        const form = sendForm(doc, {
          from,
          edge,
          actor: decision.actor,
          note,
          edit: handlers.edit,
          send: () => {
            handlers.sendEvent({ event: edge.event, actor: decision.actor, edge: edge.id });
            focusEdge(from.root, { id: edge.id });
          },
        });
        const parts = [timerLine(edge), sent, form].filter((part) => part !== undefined);
        return parts.length === 1 ? form : html(doc, "div", {}, parts);
      }
    }
  }
  return sendOf;
}

interface SentHereOptions {
  machine: VizMachine;
  view: ViewState;
  edge: VizEdge;
}

/** After a send from this arrow: what was sent and where it went. */
function sentHere(doc: Document, from: SentHereOptions): HTMLElement | undefined {
  const { view, edge } = from;
  const { sent } = view;
  if (sent?.edge !== edge.id) return undefined;
  const outcome = sentOutcome(doc, { machine: from.machine, view });
  if (outcome === undefined) return undefined;
  return html(doc, "p", { "data-details-sent": "" }, [...sentEventLine(doc, sent), ...outcome]);
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

/** The panel redraws once Send is pressed; focus moves to the selected arrow so keyboard users keep their place. */
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
