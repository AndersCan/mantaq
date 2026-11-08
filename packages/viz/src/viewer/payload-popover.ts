import { movesFrom, payloadSamples } from "../moves.ts";
import type { VizLiveState, VizMachine, VizStep } from "../schema.ts";
import { html } from "./dom.ts";
import { payloadForm } from "./explore.ts";

const GAP = 6;
const MARGIN = 4;

/** The diagram element the form points at: the event's edge from the current state, if drawn. */
function anchorOf(
  canvas: HTMLElement,
  context: { machine: VizMachine; state: string; event: string },
): Element | null {
  const id = movesFrom(context.machine, context.state).find(
    (move) => move.edge.event === context.event,
  )?.edge.id;
  if (id === undefined) return null;
  return (
    [...canvas.querySelectorAll("[data-edge-id]")].find(
      (element) => element.getAttribute("data-edge-id") === id,
    ) ?? null
  );
}

/** Below the anchor, centred on it, kept inside the canvas; top-left without one. */
function place(popover: HTMLElement, canvas: HTMLElement, anchor: Element | null): void {
  if (anchor === null) {
    popover.style.left = `${MARGIN + canvas.scrollLeft}px`;
    popover.style.top = `${MARGIN + canvas.scrollTop}px`;
    return;
  }
  const box = canvas.getBoundingClientRect();
  const at = anchor.getBoundingClientRect();
  const centre = at.left - box.left + canvas.scrollLeft + at.width / 2;
  const widest = canvas.scrollWidth - popover.offsetWidth - MARGIN;
  popover.style.left = `${Math.max(MARGIN, Math.min(centre - popover.offsetWidth / 2, widest))}px`;
  popover.style.top = `${at.bottom - box.top + canvas.scrollTop + GAP}px`;
}

/**
 * The payload form as a popover on the diagram, next to the edge it will
 * take, so the question appears where the click happened. Escape closes it.
 * Replaces any earlier popover; nothing is shown when no event is composing.
 */
export function showPayloadPopover(
  canvas: HTMLElement,
  context: {
    machine: VizMachine;
    live: VizLiveState | null;
    composing: string | null;
    send: (step: VizStep) => void;
    compose: (event: string | null) => void;
  },
): void {
  for (const old of canvas.querySelectorAll(".payload-popover")) old.remove();
  const { machine, live, composing: event } = context;
  if (live === null || event === null) return;
  const doc = canvas.ownerDocument;
  const close = () => context.compose(null);
  const popover = html(doc, "div", {
    class: "payload-popover",
    role: "dialog",
    "aria-label": `Payload for ${event}`,
  });
  popover.append(
    payloadForm(doc, {
      event,
      samples: payloadSamples(machine, event),
      fields: machine.events.find((each) => each.id === event)?.payload ?? null,
      live,
      send: context.send,
      close,
    }),
  );
  popover.addEventListener("keydown", (key) => {
    if (key.key === "Escape") close();
  });
  canvas.append(popover);
  place(popover, canvas, anchorOf(canvas, { machine, state: live.state, event }));
  popover.querySelector<HTMLElement>("textarea, input, select")?.focus({ preventScroll: true });
}
