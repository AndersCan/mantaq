import { canvasOf, keepCurrentInView, listenWidth, staticCallbacks } from "./mount/canvas.ts";
import { decodeFocus, enteredBy, focusReader, startOf } from "./mount/focus.ts";
import { drawCallbacks, pickChild, sayWhy } from "./mount/arrow-click.ts";
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
  const first = viz.machines.find((machine) => machine.id === options.machine) ?? startOf(viz);
  const view = initialView(options, { events: viz.machines.flatMap((machine) => machine.events) });
  const { driver } = options;
  openInitial(view, { machine: first, driver, options });
  if (first) view.focus = decodeFocus(options.focus ?? [], { viz, root: first });
  const redraws: Redraws = { redraw: () => undefined, refit: () => undefined };
  listenFullscreen(root);
  listenWidth(root, { refit: () => redraws.refit() });
  watchDriver(view, { driver, redraw: () => redraws.redraw() });
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

/** What a driver event or a width change redraws; the last drawn machine sets them. */
interface Redraws {
  redraw: () => void;
  refit: () => void;
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
  const focus = focusReader(view, { viz: context.viz, root: machine });
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
      ...liveOf(view, { send, pick: pickRow, routes: options.routes }),
    });
    const details = renderPanel(doc, {
      machine: shown(),
      selection: view.selection,
      select: showDetails,
      ...(focus().canvas === "board" ? { hint: "Click a machine to see its states." } : {}),
      ...(focus().walk === "live"
        ? { send: sendFor({ root, doc, machine, view, driver }, { sendEvent, edit }) }
        : {}),
    });
    const screenView = focus().walk === "live" ? view : { ...view, selection: null };
    const screen = screenOf(doc, { options, machine, view: screenView, driver });
    const tabs = panelTabs(doc, { view, parts: stepTab, details, screen, refresh });
    shownSteps = replaceKeepingSteps(panel, {
      tabs,
      shown: shownSteps,
      steps: view.live?.steps.length ?? 0,
    });
    if (view.diagramOnly) whyNot();
    mark();
  }
  /** Diagram only: the line under the drawing says why the root's selected arrow sent nothing; an entered machine sends nothing, so it is empty. */
  function whyNot(): void {
    if (focus().walk === "live") return sayWhy(root, { machine, view, driver });
    const line = root.querySelector(".viz-main > .blocked-note");
    if (line !== null) line.textContent = "";
  }
  function pickRow(child: PickedChild): void {
    pickChild(child, { root, view, refresh, source: "row" });
  }
  function pickChip(child: PickedChild): void {
    pickChild(child, { root, view, refresh, source: "chip" });
  }
  function mark(): void {
    markDiagram(root, { machine, view, driver, pick: pickChip, walk: focus().walk });
  }
  function follow(): void {
    refresh();
    keepCurrentInView(root, { focus: focus(), view });
  }
  context.redraws.redraw = follow;
  function walked(sent?: ViewState["sent"]): void {
    view.sent = sent;
    noticeCleared(root, view);
    navigated(options, { machine, view });
    follow();
  }
  const edit = payloadSetter({ options, machine, view, mark });
  const send = stepSender({ view, driver, walked });
  const sendEvent = eventSender({ machine, view, driver, send });
  function rewind(length: number): void {
    rewindView(view, { driver, length });
    walked();
  }
  function showDetails(selection: Selection): void {
    view.selection = selection;
    const previewed = view.tab === "screen" && selection.kind === "state";
    if (!previewed || focus().walk === "static") view.tab = "details";
    refresh();
  }
  function openDetails(selection: Selection): void {
    showDetails(selection);
    if (selection.kind === "state" && panel.isConnected) {
      panel.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function callbacks(): GraphCallbacks {
    if (focus().walk === "static") return staticCallbacks(view, { openDetails });
    return drawCallbacks({ machine, view, driver }, { shown: shown(), openDetails, sendEvent });
  }
  function moved(move: FocusMove): void {
    if (move.before.machine !== move.after.machine) view.selection = null;
    navigated(options, { machine, view });
    const entered = enteredBy(move);
    if (entered !== undefined) options.onEnter?.(entered);
  }
  const canvas = canvasOf({ doc, root, view, focus, callbacks, moved, afterSwap: refresh, mark });
  context.redraws.refit = canvas.refit;
  root.append(...layoutOf(doc, { view, showControls, graph: canvas.drawn(), panel, root }));
  canvas.framed();
  canvas.refit();
  follow();
}
