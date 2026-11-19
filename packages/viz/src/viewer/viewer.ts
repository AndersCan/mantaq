import type {
  VizDocument,
  VizActorRef,
  VizDriver,
  VizEdge,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizOutputRoutes,
  VizStep,
} from "../schema.ts";
import { scopeOf } from "../schema.ts";
import { currentsOf, walkedChild } from "./compartments.ts";
import { html } from "./dom.ts";
import { BOARD_PX_PER_UNIT, renderBoard, renderGraph } from "./graph.ts";
import type { GraphCallbacks, Selection } from "./graph.ts";
import { partMachine, partOf, partsOf } from "./parts.ts";
import { renderPanel } from "./panel.ts";
import { decodeLiveSteps, encodeLiveStep, movesFrom } from "../moves.ts";
import {
  button,
  code,
  elapsed,
  explorePanel,
  listOf,
  markExplore,
  outcomeText,
  sentEventLine,
} from "./explore.ts";
import type { ExploreContext, ExploreParts, SentEvent } from "./explore.ts";
import { pathTo } from "../findings.ts";
import { blockedEdges, sentByParts, whyNotHere } from "./blocked.ts";
import { arrowCandidates, decodeValues, encodeValues, payloadFor } from "./fill.ts";
import type { Values } from "./fill.ts";
import { keepInBand, keepInView } from "./keep-in-view.ts";
import { drawChildMarkers, drawQueue } from "./markers.ts";
import { queueOf } from "./queue.ts";
import { memberAt, shareArrows } from "./shared.ts";
import { tabs } from "./tabs.ts";
import type { Tab } from "./tabs.ts";

interface ViewState {
  selection: Selection | null;
  /** The machine of a big board shown on its own; null = the board of boxes. Not saved. */
  zoom: string | null;
  /** The state of the shown machine last scrolled into the band; null when none. Not saved. */
  followed: string | null;
  /** Set while a driver runs the actor. */
  live: VizLiveState | null;
  /** Entry i is what the driver reported moving after `live.steps[i]` (its `after`) when that step was taken. */
  afters: VizLiveStep[][];
  /** Entry i is the step's own entry (`live.last`) when `live.steps[i]` was taken. */
  lasts: Array<VizLiveStep | null>;
  /** Live: the followed child, set by a chip click; null = the lowest key. */
  picked: { map: string; key: string } | null;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Only the diagram and a "Show controls" button are drawn. Starts from `ViewerOptions.diagramOnly`; not saved. */
  diagramOnly: boolean;
  /** The event the last Send press sent and to whom; cleared by any other step. */
  sent: SentEvent | null;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | null;
  /** Live: edge id → why its guard blocks it now (see `blocked.ts`). */
  blocked: Map<string, string>;
  /** Live: edge id → the payload a click on that arrow sends (see `blockedEdges`); none = the default. */
  chosen: Map<string, VizJson>;
  /** Field name → the value set in the Context tab; events are sent with it (kept in `?value=`). */
  values: Values;
  /** What `blocked` was computed for; it is recomputed when any of it changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"]; values: Values } | null;
}

type PanelTab = "screen" | "step" | "context" | "details";

export interface ViewerOptions {
  /** Machine to show; defaults to the first. */
  machine?: string;
  /** Live steps (from `?step=`) replayed through `driver`; ignored without one. */
  steps?: ReadonlyArray<string>;
  /**
   * Runs the machine for real: steps go to the driver and the cursor follows its state.
   * The driver runs one machine.
   */
  driver?: VizDriver;
  /** Name of a run in the shown machine's `runs` to open on (from `?run=`). Wins over `steps`. Replays only with a `driver`. */
  run?: string;
  /** Values events are sent with, as `name=<json>` (from `?value=`); the Context tab sets them. */
  values?: ReadonlyArray<string>;
  /** Called after every walk, or value change, e.g. to keep the URL shareable. */
  onNavigate?: (where: { machine: string; steps: string[]; values: string[] }) => void;
  /** Live: where each machine's outputs go, so a step can name the machine it told. Unset: output names only. */
  routes?: VizOutputRoutes;
  /** Live only (ignored without `driver`): a first "Screen" tab, open by default, holding what this returns for the cursor's state, or, while a state is selected, for that state as a throwaway copy reaches it. */
  screen?: (state: VizLiveState) => Node;
  /** Open with only the diagram and a "Show controls" button, e.g. a docs page that explains one idea. Default false. */
  diagramOnly?: boolean;
}

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
  const view = initialView(options);
  const { driver } = options;
  openInitial(view, { machine: first, driver, options });
  let redraw: () => void = () => undefined;
  listenFullscreen(root);
  let refit: () => void = () => undefined;
  listenWidth(root, () => refit());
  watchDriver(view, { driver, redraw: () => redraw() });
  function showControls(): void {
    view.diagramOnly = false;
    view.tab = "step";
    render();
    root
      .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }
  function render(): void {
    const machine = first;
    root.replaceChildren();
    root.classList.add("viz", "not-content");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    root.classList.toggle("diagram-only", view.diagramOnly);
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    const parts = partsOf(machine);
    const shown = () => (view.zoom === null ? machine : partMachine(machine, view.zoom));
    // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
    let shownSteps = 0;
    const refresh = () => {
      dropGonePick(view);
      const stepTab = explorePanel(doc, {
        machine,
        rewind,
        ...liveOf(view, {
          send,
          pick: (child) => pick(child, "row"),
          setValue,
          routes: options.routes,
        }),
      });
      const details = renderPanel(doc, shown(), {
        selection: view.selection,
        select: showDetails,
        ...(parts.length > 0 && view.zoom === null
          ? { hint: "Click a machine to see its states." }
          : {}),
        send: sendFor({ root, doc, machine, view, driver }, { sendEvent }),
      });
      const screen = screenOf(doc, options, { machine, view, driver });
      const tabs = panelTabs(doc, { view, parts: stepTab, details, screen, refresh });
      shownSteps = replaceKeepingSteps(panel, tabs, shownSteps, view.live?.steps.length ?? 0);
      if (view.diagramOnly) sayWhy(root, { machine, view, driver });
      mark();
    };
    const pick = (child: PickedChild, from: "row" | "chip") =>
      pickChild({ root, view, refresh }, child, from);
    const mark = () =>
      markDiagram(root, { machine, view, driver, pick: (child) => pick(child, "chip") });
    const follow = (opening = false) => {
      refresh();
      keepCurrentInView(root, { machine, view }, opening);
    };
    redraw = () => follow();
    const walked = (sent?: ViewState["sent"]) => {
      view.sent = sent ?? null;
      noticeCleared(root, view);
      navigated(options, { machine, view });
      follow();
    };
    const setValue = valueSetter({ options, machine, view, mark });
    const send = stepSender({ view, driver, walked });
    const sendEvent = eventSender({ machine, view, send });
    const rewind = (length: number) => {
      rewindView(view, driver, length);
      walked();
    };
    const showDetails = (selection: Selection) => {
      view.selection = selection;
      if (!(view.tab === "screen" && selection.kind === "state")) view.tab = "details";
      refresh();
    };
    const openDetails = (selection: Selection) => {
      showDetails(selection);
      if (selection.kind === "state" && panel.isConnected) {
        panel.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    const callbacks = () =>
      drawCallbacks({ machine, view, driver }, { shown: shown(), openDetails, sendEvent });
    const canvas = canvasOf({
      doc,
      root,
      machine,
      view,
      shown,
      callbacks,
      afterSwap: refresh,
      mark,
    });
    refit = canvas.refit;
    root.append(...layoutOf(doc, { view, showControls, graph: canvas.drawn(), panel, root }));
    canvas.titled();
    canvas.refit();
    follow(true);
  }

  render();
}

/** Scrolls to the live state; in a shown machine, to a state drawn there, and the page up or down when a step moves it out of view. */
function keepCurrentInView(
  root: HTMLElement,
  from: { machine: VizMachine; view: ViewState },
  opening: boolean,
): void {
  const { machine, view } = from;
  if (view.live === null) return;
  const live = currentsOf(view.live, view.picked);
  const currents =
    view.zoom === null ? live : live.filter((id) => partOf(machine, id) === view.zoom);
  const child = live[live.length - new Set(view.live.children.map((c) => c.map)).size];
  keepInView(
    root,
    opening && child !== undefined ? [child, ...currents.slice(0, 1)] : currents.slice(0, 1),
  );
  const now = currents[0];
  if (view.zoom !== null && now !== undefined && now !== view.followed) {
    view.followed = now;
    keepInBand(root, now);
  }
}

/** Calls `refit` when the window width changes, which entering full screen does too. */
function listenWidth(root: HTMLElement, refit: () => void): void {
  const refitHere = () => {
    if (root.isConnected) refit();
  };
  root.ownerDocument.defaultView?.addEventListener("resize", refitHere);
  root.addEventListener("fullscreenchange", refitHere);
}

/** Diagram only: the line under the board says why the selected arrow's click sent nothing. */
function sayWhy(
  root: HTMLElement,
  from: { machine: VizMachine; view: ViewState; driver: VizDriver | undefined },
): void {
  const { selection, sent } = from.view;
  const edge = from.machine.edges.find((e) => selection?.kind === "edge" && e.id === selection.id);
  const decision = edge === undefined || sent?.edge === edge.id ? undefined : arrowSend(from, edge);
  const line = root.querySelector(".viz-main > .blocked-note");
  if (line !== null) line.textContent = decision?.kind === "refuse" ? decision.text : "";
}

/** A click on an arrow sends when Details would offer Send, else opens its Details. */
function drawCallbacks(
  from: { machine: VizMachine; view: ViewState; driver: VizDriver | undefined },
  handlers: {
    shown: VizMachine;
    openDetails: (selection: Selection) => void;
    sendEvent: (event: string, actor?: VizActorRef, edge?: string) => void;
  },
): GraphCallbacks {
  const { machine, view } = from;
  return {
    select: (clicked) => {
      const selection = memberSelection(handlers.shown, view, clicked);
      const edge = machine.edges.find((e) => selection.kind === "edge" && e.id === selection.id);
      const decision = edge && arrowSend(from, edge);
      if (edge === undefined || decision?.kind !== "send") {
        if (edge !== undefined) view.sent = null;
        return handlers.openDetails(selection);
      }
      view.selection = selection;
      handlers.sendEvent(edge.event, decision.actor, edge.id);
    },
    ...(view.diagramOnly
      ? {}
      : {
          details: (id: string) =>
            handlers.openDetails(memberSelection(handlers.shown, view, { kind: "edge", id })),
        }),
  };
}

/** Board width in units where the canvas has no size (not laid out). */
const BOARD_UNITS_UNMEASURED = 800;

/** What the canvas draws: the board of boxes or one machine of it, and the redraw when the window width changes. */
function canvasOf(from: {
  doc: Document;
  root: HTMLElement;
  machine: VizMachine;
  view: ViewState;
  shown: () => VizMachine;
  callbacks: () => GraphCallbacks;
  afterSwap: () => void;
  mark: () => void;
}): { drawn: () => Node[]; refit: () => void; titled: () => void } {
  const { doc, root, machine, view, shown } = from;
  const onBoard = () => partsOf(machine).length > 0 && view.zoom === null;
  const canvasUnits = () => {
    const canvas = root.querySelector<HTMLElement>(".canvas");
    return (canvas ?? root).clientWidth / BOARD_PX_PER_UNIT || BOARD_UNITS_UNMEASURED;
  };
  let drawnUnits = 0;
  const swap = () => {
    root.querySelector(".canvas")?.replaceChildren(...drawn());
    titled();
  };
  const titled = () => {
    root.querySelector(".part-title")?.remove();
    if (view.zoom === null) return;
    const bar = root.querySelector(".viz-bar") ?? html(doc, "div", { class: "viz-bar" });
    if (!bar.isConnected) root.prepend(bar);
    bar.prepend(titleOf());
  };
  const open = (part: string) => {
    view.zoom = part;
    swap();
    from.afterSwap();
    const at =
      root.querySelector<SVGGElement>(".graph g.state.current") ??
      root.querySelector<SVGGElement>(".graph g.state.initial");
    view.followed = at?.getAttribute("data-node-id") ?? null;
    at?.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (view.followed !== null) keepInBand(root, view.followed);
    root.querySelector<HTMLElement>(".part-title")?.focus({ preventScroll: true });
  };
  const leave = () => {
    view.zoom = null;
    view.followed = null;
    swap();
    from.afterSwap();
  };
  const drawn = (): Node[] => {
    drawnUnits = canvasUnits();
    if (onBoard()) return [renderBoard(doc, machine, { width: drawnUnits, open })];
    const graph = renderGraph(doc, shown(), from.callbacks());
    if (view.zoom !== null) graph.setAttribute("data-zoom", view.zoom);
    return [graph];
  };
  const titleOf = () => {
    const title = html(doc, "button", { type: "button", class: "part-title" }, [shown().id]);
    title.setAttribute("aria-label", `${shown().id}: show all machines`);
    title.addEventListener("click", leave);
    return title;
  };
  const refit = () => {
    if (!onBoard() || canvasUnits() === drawnUnits) return;
    swap();
    from.mark();
  };
  return { drawn, refit, titled };
}

type PickedChild = { map: string; key: string };

/** Shows a child machine's own states; from its row, focus returns to the row. */
function pickChild(
  from: { root: HTMLElement; view: ViewState; refresh: () => void },
  child: PickedChild,
  source: "row" | "chip",
): void {
  const { root, view } = from;
  view.picked = child;
  view.selection = null;
  view.tab = "step";
  from.refresh();
  if (source !== "row") return;
  [...root.querySelectorAll<HTMLElement>("li.explore-child")]
    .find(
      (row) =>
        row.getAttribute("data-child-map") === child.map &&
        row.getAttribute("data-child-key") === child.key,
    )
    ?.focus({ preventScroll: true });
}

/** A shared arrow acts as the member of the current state; with none, it is its own Details. */
function memberSelection(machine: VizMachine, view: ViewState, selection: Selection): Selection {
  const arrow = shareArrows(machine).arrows.find(
    (each) => selection.kind === "edge" && each.id === selection.id,
  );
  const member = arrow && view.live && memberAt(arrow, currentsOf(view.live, view.picked));
  return member ? { kind: "edge", id: member.id } : selection;
}

type ArrowSend =
  | { kind: "send"; actor: VizActorRef | undefined }
  | { kind: "refuse"; text: string }
  | { kind: "elsewhere"; text: string }
  | { kind: "none" };

/** What a click on this arrow does: the one decision Details and the diagram share. */
function arrowSend(
  from: { machine: VizMachine; view: ViewState; driver: VizDriver | undefined },
  edge: VizEdge,
): ArrowSend {
  const { machine, view } = from;
  if (view.live === null) return { kind: "none" };
  if (edge.kind !== "transition" && edge.kind !== "stay") return { kind: "none" };
  const by = sentByParts(machine, edge);
  if (by.length > 0)
    return { kind: "refuse", text: `${edge.event} is sent by ${by.join(" and ")}, not by hand.` };
  const why = whyNotHere(machine, edge, { live: view.live, picked: view.picked });
  if (why !== null) return { kind: "elsewhere", text: why };
  updateBlocked(machine, view, from.driver);
  const reason = view.blocked.get(edge.id);
  if (reason !== undefined) return { kind: "refuse", text: reason };
  const actor = actorOf(machine, edge, { state: view.live, picked: view.picked });
  if (actor === "none") return { kind: "none" };
  const sendable = currentsOf(view.live, view.picked).some((current) =>
    movesFrom(machine, current).some((move) => move.edge.id === edge.id),
  );
  return sendable ? { kind: "send", actor } : { kind: "none" };
}

/** The selected arrow's Send: one button when its source is current; blocked, the reason; no driver, none. */
function sendFor(
  from: {
    root: HTMLElement;
    doc: Document;
    machine: VizMachine;
    view: ViewState;
    driver: VizDriver | undefined;
  },
  handlers: {
    sendEvent: (event: string, actor?: VizActorRef, edge?: string) => void;
  },
): (edge: VizEdge) => HTMLElement | null {
  const { doc, machine, view } = from;
  const timerLine = (edge: VizEdge): HTMLElement | null => {
    const { live } = view;
    const timer = live?.timers.find((each) => each.eventName === edge.event);
    if (live === null || timer === undefined) return null;
    const left = timer.deadline - elapsed(live.steps);
    return html(doc, "p", { "data-timer-line": edge.event }, [
      code(doc, edge.event),
      ` fires on its own in ${left} ms; a click sends it now.`,
    ]);
  };
  const sendOf = (edge: VizEdge): HTMLElement | null => {
    const decision = arrowSend(from, edge);
    const note = (text: string) =>
      html(doc, "p", { class: "blocked-note", "data-blocked-note": edge.event }, [text]);
    const here = (button: HTMLElement | null) => sentHere(doc, { machine, view, edge }, button);
    switch (decision.kind) {
      case "none":
        return here(null);
      case "refuse":
        return note(decision.text);
      case "elsewhere":
        return here(null) ?? note(decision.text);
      case "send": {
        const { actor } = decision;
        const to = actor !== undefined && "map" in actor ? [" to ", code(doc, actor.key)] : [];
        const sent = here(
          button(doc, ["Send ", code(doc, edge.event), ...to], {
            onClick: () => {
              handlers.sendEvent(edge.event, actor, edge.id);
              focusEdge(from.root, edge.id);
            },
            attrs: { "data-send-edge": edge.id },
          }),
        );
        const line = timerLine(edge);
        return line === null ? sent : html(doc, "div", {}, sent === null ? [line] : [line, sent]);
      }
    }
  };
  return sendOf;
}

/** After a Send from this arrow's Details: what was sent and where it went, then the button when it can still be pressed. */
function sentHere(
  doc: Document,
  from: { machine: VizMachine; view: ViewState; edge: VizEdge },
  sendButton: HTMLElement | null,
): HTMLElement | null {
  const { machine, view, edge } = from;
  const { sent } = view;
  if (sent?.edge !== edge.id) return sendButton;
  const outcome = sentOutcome(doc, machine, view);
  if (outcome === null) return sendButton;
  const line = html(doc, "p", { "data-details-sent": "" }, [
    ...sentEventLine(doc, sent),
    ...outcome,
  ]);
  return html(doc, "div", {}, [line, sendButton]);
}

/** Where the last Send went: the driver's outcome. */
function sentOutcome(
  doc: Document,
  machine: VizMachine,
  view: ViewState,
): Array<Node | string> | null {
  const { last } = view.live ?? {};
  if (last !== undefined) {
    if (last === null) return null;
    const text = outcomeText(doc, machine, last);
    // A move's text opens with the event and who ran it, which the sent line already names.
    const tail = last.outcome === "missing" ? [": ", ...text] : [": ", ...text.slice(-1)];
    return last.error === null ? tail : [...tail, `. It threw: ${last.error}`];
  }
  return null;
}

/** The Send button goes once pressed; focus moves to the selected arrow so keyboard users keep their place. */
function focusEdge(root: HTMLElement, id: string): void {
  const edges = [...root.querySelectorAll<SVGElement>("g[data-edge-id]")];
  edges
    .find(
      (each) =>
        each.getAttribute("data-edge-id") === id || listOf(each.dataset["members"])?.includes(id),
    )
    ?.focus({ preventScroll: true });
}

function setFullscreenLabel(button: HTMLButtonElement, active: boolean): void {
  button.textContent = active ? "Exit full screen" : "Full screen";
  button.setAttribute("aria-pressed", String(active));
}

/** Added once: the button label follows fullscreen across renders. */
function listenFullscreen(root: HTMLElement): void {
  root.addEventListener("fullscreenchange", () => {
    const toggle = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
    if (toggle !== null) setFullscreenLabel(toggle, root.ownerDocument.fullscreenElement === root);
  });
}

/** Null where the browser cannot fullscreen an element (no API, or blocked by the host page). */
function fullscreenButton(doc: Document, root: HTMLElement): HTMLButtonElement | null {
  if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== "function") return null;
  const button = html(doc, "button", { type: "button", class: "fullscreen-toggle" });
  setFullscreenLabel(button, doc.fullscreenElement === root);
  button.addEventListener("click", () => {
    const request =
      doc.fullscreenElement === root ? doc.exitFullscreen() : root.requestFullscreen();
    // A refused request leaves the viewer as it was.
    request.catch(() => undefined);
  });
  return button;
}

/** Everything the viewer draws under its root: the controls and panel, or with Diagram only just the canvas. */
function layoutOf(
  doc: Document,
  context: {
    view: ViewState;
    showControls: () => void;
    graph: Node[];
    panel: HTMLElement;
    root: HTMLElement;
  },
): HTMLElement[] {
  const { view } = context;
  const canvas = html(doc, "div", { class: "canvas" }, context.graph);
  const fullscreen = fullscreenButton(doc, context.root);
  if (!view.diagramOnly) {
    return [
      ...(fullscreen === null ? [] : [html(doc, "div", { class: "viz-bar" }, [fullscreen])]),
      ...noticeOf(doc, view),
      html(doc, "div", { class: "viz-main" }, [canvas, context.panel]),
    ];
  }
  const show = html(doc, "button", { type: "button", class: "show-controls" }, ["Show controls"]);
  show.setAttribute("data-show-controls", "");
  show.addEventListener("click", () => context.showControls());
  return [
    html(doc, "div", { class: "viz-bar" }, fullscreen === null ? [show] : [show, fullscreen]),
    html(doc, "div", { class: "viz-main" }, [
      canvas,
      html(doc, "p", { class: "blocked-note", role: "status" }),
    ]),
  ];
}

function rewindView(view: ViewState, driver: VizDriver | undefined, length: number): void {
  const keep = Math.max(0, length);
  if (driver !== undefined && view.live !== null)
    replayInto(view, driver, view.live.steps.slice(0, keep));
}

function screenOf(
  doc: Document,
  options: ViewerOptions,
  at: { machine: VizMachine; view: ViewState; driver: VizDriver | undefined },
): Node | undefined {
  const { machine, view, driver } = at;
  const live = view.live;
  if (live === null || options.screen === undefined) return undefined;
  const picked = view.selection;
  const wanted =
    picked?.kind === "state" &&
    picked.id !== live.state &&
    machine.states.some((state) => state.id === picked.id && state.region === null)
      ? picked.id
      : null;
  if (wanted === null) return options.screen(live);
  const preview = previewOf(machine, { driver, id: wanted });
  const note = html(doc, "p", { class: "muted", "data-screen-of": wanted }, [
    preview === null
      ? `No known walk reaches ${wanted}; this is ${live.state}.`
      : `This is ${wanted}; the machine is still in ${live.state}.`,
  ]);
  return html(doc, "div", {}, [note, options.screen(preview ?? live)]);
}

function previewOf(
  machine: VizMachine,
  of: { driver: VizDriver | undefined; id: string },
): VizLiveState | null {
  const steps = pathTo(machine, of.id);
  if (steps === null) return null;
  return of.driver?.dryWalk?.(steps).find((entry) => entry.state === of.id) ?? null;
}

function initialView(options: ViewerOptions): ViewState {
  return {
    selection: null,
    zoom: null,
    followed: null,
    live: null,
    afters: [],
    lasts: [],
    picked: null,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
    sent: null,
    notice: null,
    blocked: new Map(),
    chosen: new Map(),
    values: decodeValues(options.values ?? []),
    blockedFor: null,
  };
}

function noticeOf(doc: Document, view: ViewState): HTMLElement[] {
  if (view.notice === null) return [];
  return [
    html(doc, "p", { class: "run-notice", role: "status", "data-run-missing": "" }, [view.notice]),
  ];
}

function stepList(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>('[data-tab-panel="step"]');
}

function newestStepTop(list: HTMLElement): number {
  const newest = [...list.querySelectorAll("[data-step]")].at(-1) ?? list;
  return Math.ceil(newest.getBoundingClientRect().top - list.getBoundingClientRect().top);
}

/** Swaps the panel's content; when a step was added the newest step scrolls to the top of the Step tab, else its scroll stays. */
function replaceKeepingSteps(panel: HTMLElement, tabs: Node, shown: number, steps: number): number {
  const before = stepList(panel);
  const scrolled = before === null || before.hidden ? null : before.scrollTop;
  panel.replaceChildren(tabs);
  const list = stepList(panel);
  if (list !== null)
    list.scrollTop = steps > shown || scrolled === null ? newestStepTop(list) : scrolled;
  return steps;
}

/** Opens on the named run when it can replay, else on the start with a notice; with no run, on `steps`. */
function openInitial(
  view: ViewState,
  context: {
    machine: VizMachine | undefined;
    driver: VizDriver | undefined;
    options: ViewerOptions;
  },
): void {
  const { machine, driver, options } = context;
  if (options.run === undefined || machine === undefined) {
    if (driver !== undefined) replayInto(view, driver, decodeLiveSteps(options.steps ?? []));
    return;
  }
  const found = machine.runs.find((candidate) => candidate.name === options.run);
  if (found !== undefined && driver !== undefined) {
    replayInto(view, driver, found.steps);
    return;
  }
  if (driver !== undefined) replayInto(view, driver, []);
  view.notice = runNotice(machine, { name: options.run, found: found !== undefined });
}

function runNotice(machine: VizMachine, run: { name: string; found: boolean }): string {
  if (run.found) return `Run "${run.name}" replays only when ${machine.id} runs live.`;
  if (machine.runs.length === 0) {
    return `No run named "${run.name}" in ${machine.id}; it has no recorded runs.`;
  }
  const names = machine.runs.map((candidate) => candidate.name).join(", ");
  return `No run named "${run.name}" in ${machine.id}. Runs: ${names}`;
}

type LiveContext = NonNullable<ExploreContext["live"]>;

/** The Step, Context and Details tabs; Context only live and with value fields. */
function panelTabs(
  doc: Document,
  context: {
    view: ViewState;
    parts: ExploreParts;
    details: HTMLElement;
    screen: Node | undefined;
    refresh: () => void;
  },
): HTMLElement {
  const { view, parts } = context;
  const all: Array<Tab<PanelTab> | null> = [
    context.screen === undefined
      ? null
      : { id: "screen", label: "Screen", content: html(doc, "div", {}, [context.screen]) },
    parts.step === null ? null : { id: "step", label: "Step", content: parts.step },
    parts.context === null
      ? null
      : {
          id: "context",
          label: "Context",
          content: parts.context,
        },
    { id: "details", label: "Details", content: context.details },
  ];
  const shown = all.filter((tab): tab is Tab<PanelTab> => tab !== null);
  const active = shown.find((tab) => tab.id === view.tab)?.id ?? shown[0]?.id;
  return tabs(doc, {
    tabs: shown,
    active,
    onSelect: (id) => {
      view.tab = id;
      context.refresh();
    },
  });
}

/** The live driver's part of the panel context. */
function liveOf(
  view: ViewState,
  handlers: Pick<LiveContext, "send" | "pick" | "setValue" | "routes">,
): { live?: LiveContext } {
  if (view.live === null) return {};
  return {
    live: {
      state: view.live,
      afters: view.afters,
      lasts: view.lasts,
      picked: view.picked,
      values: view.values,
      ...handlers,
    },
  };
}

/** Who an edge click sends to: the walked child; "none" = the map has no child. */
function actorOf(
  machine: VizMachine,
  edge: VizEdge,
  live: { state: VizLiveState | null; picked: { map: string; key: string } | null },
): VizActorRef | undefined | "none" {
  const region = scopeOf(edge.from);
  if (machine.maps.includes(region)) {
    const target = live.state === null ? undefined : walkedChild(live.state, region, live.picked);
    return target === undefined ? "none" : { map: target.map, key: target.key };
  }
  return region === "" ? undefined : { region };
}

/** An effect result that arrives later replaces the live state. */
function watchDriver(
  view: ViewState,
  context: { driver: VizDriver | undefined; redraw: () => void },
): void {
  context.driver?.listen?.((state) => {
    view.live = state;
    if (view.afters.length > 0 && view.afters.length === state.steps.length) {
      view.afters[view.afters.length - 1] = state.after;
      if (state.last !== null) view.lasts[view.lasts.length - 1] = state.last;
    }
    context.redraw();
  });
}

/** Sets (or, with undefined, clears) a value: the blocked arrows are worked out again and the host hears of it. Only the marks redraw, so the box being typed in keeps focus. */
function valueSetter(context: {
  options: ViewerOptions;
  machine: VizMachine;
  view: ViewState;
  mark: () => void;
}): (name: string, value: VizJson | undefined) => void {
  const { options, machine, view, mark } = context;
  return (name, value) => {
    const { [name]: _gone, ...rest } = view.values;
    view.values = value === undefined ? rest : { ...rest, [name]: value };
    view.blockedFor = null;
    navigated(options, { machine, view });
    mark();
  };
}

/** Sends one named event as a step, remembering the arrow it came from. */
function eventSender(context: {
  machine: VizMachine;
  view: ViewState;
  send: (step: VizStep, sent?: ViewState["sent"]) => void;
}): (event: string, actor?: VizActorRef, edge?: string) => void {
  const { machine, view, send } = context;
  return (event, actor, edge) => {
    const step = eventStep(machine, view, { event, actor, edge });
    send(step, {
      event,
      ...(actor ? { actor } : {}),
      payload: step.payload,
      ...(edge === undefined ? {} : { edge }),
    });
  };
}

/** Sends a step to the driver and redraws; no driver, no step. */
function stepSender(context: {
  view: ViewState;
  driver: VizDriver | undefined;
  walked: (sent?: ViewState["sent"]) => void;
}): (step: VizStep, sent?: ViewState["sent"]) => void {
  const { view, driver, walked } = context;
  return (step, sent) => {
    if (driver === undefined) return;
    stepInto(view, driver, step);
    walked(sent);
  };
}

function noticeCleared(root: HTMLElement, view: ViewState): void {
  view.notice = null;
  root.querySelector("[data-run-missing]")?.remove();
}

/** Tells the host where the walk and the values now are. */
function navigated(options: ViewerOptions, now: { machine: VizMachine; view: ViewState }): void {
  const { machine, view } = now;
  options.onNavigate?.({
    machine: machine.id,
    steps: view.live?.steps.map(encodeLiveStep) ?? [],
    values: encodeValues(view.values),
  });
}

/** The step a click on `event` sends: its payload comes from the values set in the Context tab. */
function eventStep(
  machine: VizMachine,
  view: ViewState,
  click: { event: string; actor: VizActorRef | undefined; edge: string | undefined },
): Extract<VizStep, { kind: "event" }> {
  const { event, actor, edge } = click;
  const chosen = edge === undefined ? undefined : view.chosen.get(edge);
  const payload =
    chosen ??
    payloadFor(machine, event, { set: view.values, live: view.live, afters: view.afters });
  return { kind: "event", event, payload, ...(actor ? { actor } : {}) };
}

/** Takes one live step. */
function stepInto(view: ViewState, driver: VizDriver, step: VizStep): void {
  const length = view.live?.steps.length ?? 0;
  view.live = stepSafely(driver, { before: view.live, step });
  if (view.live.steps.length === length + 1) {
    view.afters.push(view.live.after);
    view.lasts.push(view.live.last);
  }
}

/** Sets `view.live` to the state after `steps`. */
function replayInto(view: ViewState, driver: VizDriver, steps: ReadonlyArray<VizStep>): void {
  const played = replay(driver, steps);
  view.live = played.live;
  view.afters = played.afters;
  view.lasts = played.lasts;
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
function stepSafely(
  driver: VizDriver,
  context: { before: VizLiveState | null; step: VizStep },
): VizLiveState {
  const { before, step } = context;
  try {
    return driver.step(step);
  } catch (error) {
    if (before === null) throw error;
    return {
      ...before,
      last: {
        from: before.state,
        event: step.kind === "event" ? step.event : step.kind,
        to: before.state,
        outcome: "stay",
        effects: [],
        context: before.context,
        sent: [],
        error: error instanceof Error ? error.message : String(error),
      },
      after: before.after,
    };
  }
}

/** A pick of a child that is gone is dropped. */
function dropGonePick(view: ViewState): void {
  const { picked } = view;
  const there = view.live?.children.some((c) => c.map === picked?.map && c.key === picked.key);
  if (picked !== null && there !== true) view.picked = null;
}

function sameBlocked(asked: NonNullable<ViewState["blockedFor"]>, view: ViewState): boolean {
  return (
    asked.live === view.live &&
    asked.values === view.values &&
    asked.picked?.map === view.picked?.map &&
    asked.picked?.key === view.picked?.key
  );
}

/** Recomputes the blocked arrows when the live state or the picked child changed; no `dryRun` blocks nothing. */
function updateBlocked(machine: VizMachine, view: ViewState, driver: VizDriver | undefined): void {
  const { live, blockedFor } = view;
  if (live === null || driver?.dryRun === undefined) {
    view.blocked = new Map();
    view.chosen = new Map();
    view.blockedFor = null;
    return;
  }
  if (blockedFor !== null && sameBlocked(blockedFor, view)) return;
  view.blockedFor = { live, picked: view.picked, values: view.values };
  const actorFor = (edge: VizEdge) => actorOf(machine, edge, { state: live, picked: view.picked });
  const found = blockedEdges(machine, {
    live,
    currents: currentsOf(live, view.picked),
    defaultOf: (edge) =>
      payloadFor(machine, edge.event, { set: view.values, live, afters: view.afters }),
    candidatesOf: (edge) => {
      const actor = actorFor(edge);
      return arrowCandidates(machine, edge, {
        set: view.values,
        live,
        afters: view.afters,
        actor: actor === "none" ? undefined : actor,
      });
    },
    dryRun: (steps) => driver.dryRun?.(steps) ?? [],
    actorOf: actorFor,
  });
  view.blocked = found.blocked;
  view.chosen = found.chosen;
}

/** Everything drawn over the graph: walk marks and selection. */
function markDiagram(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    view: ViewState;
    driver: VizDriver | undefined;
    pick: (child: { map: string; key: string }) => void;
  },
): void {
  const { machine, view } = context;
  updateBlocked(machine, view, context.driver);
  markExplore(root, { machine, blocked: view.blocked, ...liveState(view) });
  const graph = root.querySelector<SVGSVGElement>(".graph");
  if (graph !== null && view.live !== null) {
    drawChildMarkers(graph, {
      children: view.live.children,
      picked: view.picked,
      onPick: context.pick,
    });
    drawQueue(graph, { state: view.live.state, queue: queueOf(machine, view.live.context) });
  }
  markSelection(root, view.selection);
}

function markSelection(root: HTMLElement, selection: Selection | null): void {
  const attribute = selection?.kind === "edge" ? "edgeId" : "nodeId";
  const arrowNodes = new Set(
    selection?.kind === "edge"
      ? [...root.querySelectorAll<SVGGElement>(".graph g[data-members]")]
          .filter((arrow) => listOf(arrow.dataset["members"])?.includes(selection.id))
          .map((arrow) => arrow.dataset["from"])
      : [],
  );
  for (const element of root.querySelectorAll<SVGGElement>(".graph g")) {
    const members = listOf(element.dataset["members"]) ?? [];
    element.classList.toggle(
      "selected",
      selection !== null &&
        (element.dataset[attribute] === selection.id ||
          (selection.kind === "edge" && members.includes(selection.id)) ||
          (element.dataset["states"] !== undefined && arrowNodes.has(element.dataset["nodeId"]))),
    );
  }
}

function liveState(view: ViewState): { currents?: string[] } {
  return view.live === null ? {} : { currents: currentsOf(view.live, view.picked) };
}

/** Back is reset plus replay: the driver keeps no history. Stops at the first step the driver throws on. */
function replay(
  driver: VizDriver,
  steps: ReadonlyArray<VizStep>,
): { live: VizLiveState; afters: VizLiveStep[][]; lasts: Array<VizLiveStep | null> } {
  let live = driver.reset();
  const afters: VizLiveStep[][] = [];
  const lasts: Array<VizLiveStep | null> = [];
  for (const step of steps) {
    const length = live.steps.length;
    live = stepSafely(driver, { before: live, step });
    if (live.steps.length === length + 1) {
      afters.push(live.after);
      lasts.push(live.last);
    }
    if (live.last?.error) return { live, afters, lasts };
  }
  return { live, afters, lasts };
}
