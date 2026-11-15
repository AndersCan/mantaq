import { movesFrom } from "../moves.ts";
import type { VizActorRef, VizLiveState, VizMachine } from "../schema.ts";
import { html } from "./dom.ts";

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

/** The sheet element: the sentence saying why the arrow is blocked. */
function sheetFor(doc: Document, context: { event: string; reason: string }): HTMLElement {
  const sheet = html(doc, "section", {
    class: "payload-sheet",
    role: "dialog",
    "aria-label": context.reason,
    "data-blocked-note": context.event,
  });
  sheet.append(html(doc, "p", {}, [context.reason]));
  return sheet;
}

/** A note has no field, so the sheet takes focus, which lets Escape close it. */
function focusSheet(sheet: HTMLElement): void {
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
 * The blocked note as a sheet pinned to the bottom of the viewer; the event's edge on the
 * diagram is marked. Escape closes it. Replaces any earlier sheet; nothing is shown when no
 * event is composing or its edge is not blocked.
 */
export function showPayloadSheet(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    live: VizLiveState | null;
    composing: string | null;
    /** The region the open form sends to; none = the machine itself. */
    composingActor?: VizActorRef;
    /** Edge id → why its guard blocks it. */
    blocked?: ReadonlyMap<string, string>;
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
  const reason = blockedNote(anchor, context.blocked);
  if (reason === null) {
    if (focusBack !== null) {
      root.querySelector<HTMLElement>(focusBack)?.focus({ preventScroll: true });
    }
    return;
  }
  anchor?.setAttribute("data-composing", "");
  const sheet = sheetFor(doc, { event, reason });
  sheet.addEventListener("keydown", (key) => {
    if (key.key === "Escape") close();
  });
  if (opener !== null) openedFrom.set(sheet, opener);
  root.append(sheet);
  focusSheet(sheet);
}
