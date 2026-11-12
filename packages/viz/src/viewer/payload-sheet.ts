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

function blockedNote(
  anchor: Element | null,
  blocked: ReadonlyMap<string, string> | undefined,
): string | null {
  return blocked?.get(anchor?.getAttribute("data-edge-id") ?? "") ?? null;
}

/** The sheet element: the blocked note when there is a reason, else the form. */
function sheetFor(
  doc: Document,
  context: { event: string; reason: string | null; body: () => HTMLElement },
): HTMLElement {
  const { event, reason } = context;
  const sheet = html(doc, "section", {
    class: "payload-sheet",
    role: "dialog",
    "aria-label": reason ?? `Payload for ${event}`,
    "data-blocked-note": reason === null ? null : event,
  });
  sheet.append(reason === null ? context.body() : html(doc, "p", {}, [reason]));
  return sheet;
}

/** The first field takes focus; a note has none, so the sheet does, which lets Escape close it. */
function focusSheet(sheet: HTMLElement): void {
  const field = sheet.querySelector<HTMLElement>("textarea, input, select");
  if (field !== null) return field.focus({ preventScroll: true });
  sheet.setAttribute("tabindex", "-1");
  sheet.focus({ preventScroll: true });
}

/** What had focus when each open form was opened: an arrow or an entry line, as a selector, since a redraw replaces the element. */
const openedFrom = new WeakMap<Element, string>();

function selectorOf(element: Element): string | null {
  for (const name of ["data-edge-id", "data-entry-event"]) {
    const value = element.getAttribute(name);
    if (value !== null) return `[${name}="${CSS.escape(value)}"]`;
  }
  return null;
}

/** Stops each sheet's keyboard tracking; called when the sheet goes. */
const stopFollowing = new WeakMap<Element, () => void>();

/**
 * Keeps the sheet and its focused field above the on-screen keyboard: sets
 * `--viz-keyboard` (the keyboard's height) and `--viz-visible` (the room left)
 * from the visual viewport. Returns the function that removes the listeners, or null without a visual viewport.
 */
function followKeyboard(sheet: HTMLElement): (() => void) | null {
  const view = sheet.ownerDocument.defaultView;
  const viewport = view?.visualViewport;
  if (!view || !viewport) return null;
  const update = () => {
    sheet.style.setProperty(
      "--viz-keyboard",
      `${Math.max(0, view.innerHeight - (viewport.height + viewport.offsetTop))}px`,
    );
    sheet.style.setProperty("--viz-visible", `${viewport.height}px`);
    const active = sheet.ownerDocument.activeElement;
    if (
      active !== null &&
      sheet.contains(active) &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
    ) {
      active.scrollIntoView({ block: "nearest" });
    }
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  sheet.addEventListener("focusin", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    sheet.removeEventListener("focusin", update);
  };
}

/**
 * Removes the open sheets. `opener` is what the next sheet returns focus to;
 * `focusBack` is set when focus was inside a removed sheet, so it must move now.
 */
export function removeSheets(root: HTMLElement): {
  opener: string | null;
  focusBack: string | null;
} {
  const active = root.ownerDocument.activeElement;
  let opener = active !== null && root.contains(active) ? selectorOf(active) : null;
  let focusBack: string | null = null;
  for (const old of root.querySelectorAll(".payload-sheet")) {
    opener = opener ?? openedFrom.get(old) ?? null;
    if (old.contains(active)) focusBack = opener;
    stopFollowing.get(old)?.();
    stopFollowing.delete(old);
    old.remove();
  }
  return { opener, focusBack };
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
    /** Edge id → why its guard blocks it; the sheet then holds that sentence instead of the form. */
    blocked?: ReadonlyMap<string, string>;
    send: (step: VizStep) => void;
    compose: (event: string | null) => void;
  },
): void {
  const doc = root.ownerDocument;
  const { opener, focusBack } = removeSheets(root);
  for (const marked of root.querySelectorAll("[data-composing]")) {
    marked.removeAttribute("data-composing");
  }
  const { machine, live, composing: event, composingActor: actor } = context;
  if (live === null || event === null) {
    if (focusBack !== null) {
      root.querySelector<HTMLElement>(focusBack)?.focus({ preventScroll: true });
    }
    return;
  }
  const close = () => context.compose(null);
  const anchor = anchorOf(root, {
    machine,
    state: actorState(live, actor),
    event,
  });
  anchor?.setAttribute("data-composing", "");
  const reason = blockedNote(anchor, context.blocked);
  const sheet = sheetFor(doc, {
    event,
    reason,
    body: () =>
      payloadForm(doc, {
        event,
        samples: payloadSamples(machine, event),
        fields: machine.events.find((each) => each.id === event)?.payload ?? null,
        live,
        send: (step) =>
          context.send(actor === undefined || step.kind !== "event" ? step : { ...step, actor }),
        close,
      }),
  });
  sheet.addEventListener("keydown", (key) => {
    if (key.key === "Escape") close();
  });
  if (opener !== null) openedFrom.set(sheet, opener);
  root.append(sheet);
  const stop = followKeyboard(sheet);
  if (stop !== null) stopFollowing.set(sheet, stop);
  focusSheet(sheet);
}
