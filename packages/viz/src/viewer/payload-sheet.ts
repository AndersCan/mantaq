import { movesFrom, payloadSamples } from "../moves.ts";
import type { VizActorRef, VizLiveState, VizMachine, VizStep } from "../schema.ts";
import { html } from "./dom.ts";
import { payloadForm } from "./explore.ts";

/** The diagram element the form points at: the event's edge from the current state, if drawn. */
function anchorOf(
  root: HTMLElement,
  context: { machine: VizMachine; state: string; event: string },
): Element | null {
  const id = movesFrom(context.machine, context.state).find(
    (move) => move.edge.event === context.event,
  )?.edge.id;
  if (id === undefined) return null;
  return (
    [...root.querySelectorAll("[data-edge-id]")].find(
      (element) => element.getAttribute("data-edge-id") === id,
    ) ?? null
  );
}

/**
 * The payload form as a sheet pinned to the bottom of the viewer, so Send is
 * always on screen; the event's edge on the diagram is marked. Escape closes
 * it. Replaces any earlier sheet; nothing is shown when no event is composing.
 */
export function showPayloadSheet(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    live: VizLiveState | null;
    composing: string | null;
    /** The region the open form sends to; none = the machine itself. */
    composingActor?: VizActorRef;
    send: (step: VizStep) => void;
    compose: (event: string | null) => void;
  },
): void {
  for (const old of root.querySelectorAll(".payload-sheet")) old.remove();
  for (const marked of root.querySelectorAll("[data-composing]")) {
    marked.removeAttribute("data-composing");
  }
  const { machine, live, composing: event, composingActor: actor } = context;
  if (live === null || event === null) return;
  const doc = root.ownerDocument;
  const close = () => context.compose(null);
  anchorOf(root, {
    machine,
    state: actor === undefined ? live.state : (live.regions[actor.region] ?? live.state),
    event,
  })?.setAttribute("data-composing", "");
  const sheet = html(doc, "section", {
    class: "payload-sheet",
    role: "dialog",
    "aria-label": `Payload for ${event}`,
  });
  sheet.append(
    payloadForm(doc, {
      event,
      samples: payloadSamples(machine, event),
      fields: machine.events.find((each) => each.id === event)?.payload ?? null,
      live,
      send: (step) =>
        context.send(actor === undefined || step.kind !== "event" ? step : { ...step, actor }),
      close,
    }),
  );
  sheet.addEventListener("keydown", (key) => {
    if (key.key === "Escape") close();
  });
  root.append(sheet);
  sheet.querySelector<HTMLElement>("textarea, input, select")?.focus({ preventScroll: true });
}
