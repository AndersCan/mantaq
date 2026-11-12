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

/** Gives keyboard focus back to the edge a closed form was opened from. */
function focusEdge(root: HTMLElement, id: string | null): void {
  if (id === null) return;
  [...root.querySelectorAll<HTMLElement>("[data-edge-id]")]
    .find((each) => each.getAttribute("data-edge-id") === id)
    ?.focus({ preventScroll: true });
}

/** The state the actor a form sends to is in; the machine's own when it has no actor. */
function actorState(live: VizLiveState, actor: VizActorRef | undefined): string {
  if (actor === undefined) return live.state;
  if ("region" in actor) return live.regions[actor.region] ?? live.state;
  const child = live.children.find((each) => each.map === actor.map && each.key === actor.key);
  return child?.state ?? live.state;
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
  const doc = root.ownerDocument;
  let returnTo: string | null = null;
  for (const old of root.querySelectorAll(".payload-sheet")) {
    if (old.contains(doc.activeElement)) returnTo = old.getAttribute("data-anchor");
    old.remove();
  }
  for (const marked of root.querySelectorAll("[data-composing]")) {
    marked.removeAttribute("data-composing");
  }
  const { machine, live, composing: event, composingActor: actor } = context;
  if (live === null || event === null) {
    focusEdge(root, returnTo);
    return;
  }
  const close = () => context.compose(null);
  const anchor = anchorOf(root, {
    machine,
    state: actorState(live, actor),
    event,
  });
  anchor?.setAttribute("data-composing", "");
  const sheet = html(doc, "section", {
    class: "payload-sheet",
    "data-anchor": anchor?.getAttribute("data-edge-id") ?? "",
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
