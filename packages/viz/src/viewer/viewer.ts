import { canvasOf, keepCurrentInView, listenWidth } from "./mount/canvas.ts";
import { decodeFocus, enteredBy, focusReader, unknownFocusText } from "./mount/focus.ts";
import {
  drawCallbacks,
  drawnArrowClick,
  followedLook,
  pickChild,
  sayWhy,
  whyOf,
} from "./mount/arrow-click.ts";
import { listenEscape } from "./mount/escape.ts";
import { dropGonePick, initialView, noticeCleared } from "./mount/view-state.ts";
import { eventSender, payloadSetter, stepSender } from "./mount/event-send.ts";
import type { GraphCallbacks, Selection } from "./graph.ts";
import { layoutOf, listenFullscreen } from "./mount/frame.ts";
import { liveOf, panelTabs, replaceKeepingSteps, screenOf } from "./mount/panel-tabs.ts";
import { navigated, openInitial, rewindView, watchDriver } from "./mount/walk.ts";
import type { PickedChild, ViewState } from "./mount/view-state.ts";
import type { VizDocument, VizMachine } from "../schema.ts";
import { explorePanel } from "./explore.ts";
import type { FocusMove } from "./mount/focus.ts";
import { html } from "./dom.ts";
import { markDiagram } from "./mount/diagram-marks.ts";
import { realMachineOf } from "./groups/fold-groups.ts";
import { renderPanel } from "./panel.ts";
import { sendFor } from "./mount/send-details.ts";
import type { ViewerOptions } from "./mount/viewer-options.ts";

/**
 * Mount a viewer for an viz document into `root`. With a `driver` the walk runs
 * the real actor; without one the viewer draws the diagram and Details only.
 */
export function mountViewer(
  root: HTMLElement,
  viz: VizDocument,
  options: ViewerOptions = {},
): void {
  const doc = root.ownerDocument;
  const first = viz.machines.find((machine) => machine.id === options.machine) ?? viz.machines[0];
  const view = initialView(options, { events: viz.machines.flatMap((machine) => machine.events) });
  const { driver } = options;
  openInitial(view, { machine: first, driver, options });
  const tokens = (options.focus ?? []).filter((token) => token !== "");
  if (first) {
    view.focus = decodeFocus(tokens, { root: first });
    view.focusNotice = unknownFocusText(tokens, { root: first });
  }
  const redraws: Redraws = {
    redraw: () => undefined,
    refit: () => undefined,
    escape: () => false,
    follow: () => undefined,
  };
  const opened = view.focus.length > 0 ? "claim" : "plain";
  listenEscape(root, { escape: () => redraws.escape(), opened });
  listenFullscreen(root);
  listenWidth(root, { refit: () => redraws.refit() });
  watchDriver(view, { driver, redraw: () => redraws.redraw() });
  options.followFocus?.((link) => {
    const other = link.machine !== undefined && link.machine !== first?.id;
    if (root.isConnected && !other) redraws.follow(link.focus);
  });
  function showControls(): void {
    view.diagramOnly = false;
    view.tab = "step";
    render();
    root
      .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }
  function render(): void {
    root.replaceChildren();
    root.classList.add("viz", "not-content");
    if (!first) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    drawMachine(first, { viz, root, view, options, redraws, showControls });
  }

  render();
}

/** What a driver event, a width change, Escape or a link's path does; the last drawn machine sets them. */
interface Redraws {
  redraw: () => void;
  refit: () => void;
  escape: () => boolean;
  follow: (tokens: string[]) => void;
}

interface DrawContext {
  viz: VizDocument;
  root: HTMLElement;
  view: ViewState;
  options: ViewerOptions;
  redraws: Redraws;
  showControls: () => void;
}

/** Draws the canvas and the panel for `machine`, and wires every walk, pick and click to them. */
function drawMachine(machine: VizMachine, context: DrawContext): void {
  const { root, view, options, showControls } = context;
  const doc = root.ownerDocument;
  const { driver } = options;
  root.classList.toggle("diagram-only", view.diagramOnly);
  const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
  const focus = focusReader(view, { root: machine });
  function shown(): VizMachine {
    return focus().drawn;
  }
  // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
  let shownSteps = 0;
  function refresh(): void {
    dropGonePick(view);
    const stepTab = explorePanel(doc, {
      machine,
      rewind,
      ...liveOf(view, {
        send,
        pick: pickRow,
        routes: options.routes,
        followedLook: followedLook(view),
      }),
    });
    const details = renderPanel(doc, {
      machine: shown(),
      selection: view.selection,
      select: showDetails,
      ...(focus().canvas === "board" ? { hint: "Click a machine to see its states." } : {}),
      send: sendFor({ root, doc, machine, view, driver }, { sendEvent, edit }),
      why: (arrow) =>
        whyOf(drawnArrowClick({ machine, view, driver }, { shown: shown(), id: arrow }).click),
    });
    const screen = screenOf(doc, { options, machine, view, driver });
    const tabs = panelTabs(doc, { view, parts: stepTab, details, screen, refresh });
    shownSteps = replaceKeepingSteps(panel, {
      tabs,
      shown: shownSteps,
      steps: view.live?.steps.length ?? 0,
    });
    if (view.diagramOnly) whyNot();
    mark();
  }
  /** Diagram only: the line under the drawing says why the selected arrow sent nothing. */
  function whyNot(): void {
    sayWhy(root, { from: { machine, view, driver }, shown: shown() });
  }
  function pickRow(child: PickedChild): void {
    pickChild(child, { root, view, refresh, source: "row" });
  }
  function pickChip(child: PickedChild): void {
    pickChild(child, { root, view, refresh, source: "chip" });
  }
  function mark(): void {
    markDiagram(root, { machine, shown: shown(), view, driver, pick: pickChip });
    canvas.walked();
  }
  function follow(): void {
    refresh();
    keepCurrentInView(root, { focus: focus(), view });
  }
  context.redraws.redraw = follow;
  function walked(sent?: ViewState["sent"]): void {
    view.sent = sent;
    noticeCleared(root, view);
    navigated(options, { machine, view, by: "walk" });
    follow();
  }
  const edit = payloadSetter({ options, machine, view, mark });
  const send = stepSender({ view, driver, walked });
  const sendEvent = eventSender({ machine, view, driver, send });
  function rewind(length: number): void {
    rewindView(view, { driver, length });
    walked();
  }
  function choose(selection: Selection): void {
    view.selection = selection;
    const previewed = view.tab === "screen" && selection.kind === "state";
    if (!previewed) view.tab = "details";
  }
  function showDetails(selection: Selection): void {
    choose(selection);
    refresh();
  }
  function openDetails(selection: Selection): void {
    showDetails(selection);
    if (selection.kind === "state" && panel.isConnected) {
      panel.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function callbacks(): GraphCallbacks {
    const handlers = { root, shown: shown(), openDetails, sendEvent };
    return drawCallbacks({ machine, view, driver }, handlers);
  }
  function moved(move: FocusMove): void {
    if (!drawsSelection(move.after.drawn, { selection: view.selection })) {
      view.selection = undefined;
    }
    navigated(options, { machine, view, by: move.by });
    const entered = enteredBy(move);
    if (entered !== undefined) options.onEnterGroup?.(entered);
  }
  const canvas = canvasOf({
    doc,
    root,
    view,
    focus,
    callbacks,
    moved,
    afterSwap: refresh,
    mark,
    choose,
  });
  context.redraws.refit = canvas.refit;
  context.redraws.escape = () => closeDetails(panel, { view, refresh }) || canvas.back();
  context.redraws.follow = (tokens) => canvas.follow(decodeFocus(tokens, { root: machine }));
  root.append(...layoutOf(doc, { view, showControls, graph: canvas.drawn(), panel, root }));
  canvas.framed();
  canvas.refit();
  follow();
}

interface CloseDetailsOptions {
  view: ViewState;
  refresh: () => void;
}

/** Escape first closes the Details of a selection while the Details tab shows; focus that was in it moves to the tab. False when none is open. */
function closeDetails(panel: HTMLElement, options: CloseDetailsOptions): boolean {
  const { view } = options;
  const tab = panel.querySelector('[data-tab-panel="details"]:not([hidden])');
  const open = !view.diagramOnly && tab !== null && view.selection !== undefined;
  if (!open) return false;
  const focused = panel.contains(panel.ownerDocument.activeElement);
  view.selection = undefined;
  options.refresh();
  if (focused) panel.querySelector<HTMLElement>('[data-tab="details"]')?.focus();
  return true;
}

interface DrawsSelectionOptions {
  selection: Selection | undefined;
}

/** True when `drawn` or the real machine it draws has the selected state or edge, so its Details still read true there. */
function drawsSelection(drawn: VizMachine, options: DrawsSelectionOptions): boolean {
  const { selection } = options;
  if (selection === undefined) return true;
  const ids = new Set<string>();
  for (const machine of [drawn, realMachineOf(drawn)]) {
    const selectable = selection.kind === "state" ? machine.states : machine.edges;
    for (const selected of selectable) ids.add(selected.id);
  }
  return ids.has(selection.id);
}
