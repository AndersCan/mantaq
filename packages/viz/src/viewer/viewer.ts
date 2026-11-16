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
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { renderPanel } from "./panel.ts";
import { decodeLiveSteps, encodeLiveStep, movesFrom } from "../moves.ts";
import { button, code, explorePanel, markExplore, outcomeText, sentEventLine } from "./explore.ts";
import type { ExploreContext, ExploreParts, SentEvent } from "./explore.ts";
import { pathTo } from "../findings.ts";
import { blockedEdges } from "./blocked.ts";
import { decodeValues, encodeValues, payloadFor } from "./fill.ts";
import type { Values } from "./fill.ts";
import { drawChildMarkers } from "./markers.ts";
import { tabs } from "./tabs.ts";
import type { Tab } from "./tabs.ts";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  /** Set while a driver runs the actor. */
  live: VizLiveState | null;
  /** Entry i is what the driver reported moving after `live.steps[i]` (its `after`) when that step was taken. */
  afters: VizLiveStep[][];
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
  /** Field name → the value set in the Context tab; events are sent with it (kept in `?value=`). */
  values: Values;
  /** What `blocked` was computed for; it is recomputed when any of it changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"]; values: Values } | null;
}

type PanelTab = "screen" | "step" | "context" | "details";

function machineSelect(
  doc: Document,
  viz: VizDocument,
  context: { view: ViewState; onChange: (id: string) => void },
): HTMLLabelElement | null {
  if (viz.machines.length < 2) return null;
  const select = html(
    doc,
    "select",
    { class: "machine-select" },
    viz.machines.map((machine) =>
      html(
        doc,
        "option",
        { value: machine.id, selected: machine.id === context.view.machineId ? "" : null },
        [machine.id],
      ),
    ),
  );
  select.addEventListener("change", () => context.onChange(select.value));
  return html(doc, "label", {}, ["Machine ", select]);
}

export interface ViewerOptions {
  /** Title element. Embedded viewers use `h2`/`h3` to fit the host page's outline. */
  heading?: "h1" | "h2" | "h3";
  /** Machine to show first; defaults to the first one. */
  machine?: string;
  /** Live steps (from `?step=`) replayed through `driver`; ignored without one. */
  steps?: ReadonlyArray<string>;
  /**
   * Runs the machine for real: steps go to the driver and the cursor follows its state.
   * The driver runs one machine, so the machine picker is hidden.
   */
  driver?: VizDriver;
  /** Name of a run in the shown machine's `runs` to open on (from `?run=`). Wins over `steps`. Replays only with a `driver`. */
  run?: string;
  /** Values events are sent with, as `name=<json>` (from `?value=`); the Context tab sets them. */
  values?: ReadonlyArray<string>;
  /** Called after every walk, value or machine change, e.g. to keep the URL shareable. */
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
  const view = initialView(first, options);
  const { driver } = options;
  openInitial(view, { machine: first, driver, options });
  let redraw: () => void = () => undefined;
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
    const machine = viz.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("viz", "not-content");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    root.classList.toggle("diagram-only", view.diagramOnly);
    const chrome = chromeOf(
      { root, viz, machine, view, options },
      { render, showControls, live: driver !== undefined },
    );
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
    const refresh = () => {
      dropGonePick(view);
      const stepTab = explorePanel(doc, {
        machine,
        rewind,
        ...liveOf(view, { send, sendEvent, setValue, routes: options.routes }),
      });
      const details = detailsOf(doc, {
        machine,
        view,
        select: showDetails,
        send: sendFor({ root, doc, machine, view, driver }, { sendEvent }),
      });
      const screen = screenOf(doc, options, { machine, view, driver });
      panel.replaceChildren(panelTabs(doc, { view, parts: stepTab, details, screen, refresh }));
      mark();
    };
    const mark = () => markDiagram(root, { machine, view, driver, pick: () => refresh() });
    redraw = refresh;
    const walked = (sent?: ViewState["sent"]) => {
      view.sent = sent ?? null;
      noticeCleared(root, view);
      navigated(options, { machine, view });
      refresh();
    };
    const setValue = valueSetter({ options, machine, view, mark });
    const send = stepSender({ view, driver, walked });
    const sendEvent = (event: string, actor?: VizActorRef, edge?: string) => {
      const step = eventStep(machine, view, event, actor);
      send(step, {
        event,
        ...(actor ? { actor } : {}),
        payload: step.payload,
        ...(edge === undefined ? {} : { edge }),
      });
    };
    const rewind = (length: number) => {
      rewindView(view, driver, length);
      walked();
    };
    const showDetails = (selection: Selection) => {
      view.selection = selection;
      if (!(view.tab === "screen" && selection.kind === "state")) view.tab = "details";
      refresh();
    };
    const graph = renderGraph(doc, machine, { select: showDetails });
    root.append(...layoutOf(doc, { chrome, graph, panel }));
    refresh();
  }

  render();
}

function chromeOf(
  from: {
    root: HTMLElement;
    viz: VizDocument;
    machine: VizMachine;
    view: ViewState;
    options: ViewerOptions;
  },
  rest: Pick<Chrome, "render" | "showControls" | "live">,
): Chrome {
  const { options, ...shared } = from;
  return { ...shared, ...rest, heading: options.heading ?? "h1", onNavigate: options.onNavigate };
}

/** The Details tab: the diagram's selection. */
function detailsOf(
  doc: Document,
  context: {
    machine: VizMachine;
    view: ViewState;
    select: (selection: Selection) => void;
    send: Parameters<typeof renderPanel>[2]["send"];
  },
): HTMLElement {
  return renderPanel(doc, context.machine, {
    selection: context.view.selection,
    select: context.select,
    send: context.send,
  });
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
  return (edge) => {
    if (view.live === null) return null;
    updateBlocked(machine, view, from.driver);
    const reason = view.blocked.get(edge.id);
    if (reason !== undefined) {
      return html(doc, "p", { class: "blocked-note", "data-blocked-note": edge.event }, [reason]);
    }
    const actor = actorOf(machine, edge, { state: view.live, picked: view.picked });
    if (actor === "none") return null;
    const sendable = currentsOf(view.live, view.picked).some((current) =>
      movesFrom(machine, current).some((move) => move.edge.id === edge.id),
    );
    if (!sendable) return sentHere(doc, { machine, view, edge }, null);
    const to = actor !== undefined && "map" in actor ? [" to ", code(doc, actor.key)] : [];
    const sendButton = button(doc, ["Send ", code(doc, edge.event), ...to], {
      onClick: () => {
        handlers.sendEvent(edge.event, actor, edge.id);
        focusEdge(from.root, edge.id);
      },
      attrs: { "data-send-edge": edge.id },
    });
    return sentHere(doc, { machine, view, edge }, sendButton);
  };
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
    const moved = last.outcome === "transition" || last.outcome === "stay";
    const tail = moved ? [": ", ...text.slice(-1)] : [": ", ...text];
    return last.error === null ? tail : [...tail, `. It threw: ${last.error}`];
  }
  return null;
}

/** The Send button goes once pressed; focus moves to the selected arrow so keyboard users keep their place. */
function focusEdge(root: HTMLElement, id: string): void {
  const edges = [...root.querySelectorAll<SVGElement>("g[data-edge-id]")];
  edges.find((each) => each.getAttribute("data-edge-id") === id)?.focus({ preventScroll: true });
}

/** Everything the viewer draws under its root: the controls and panel, or with Diagram only just the canvas. */
function layoutOf(
  doc: Document,
  context: {
    chrome: Chrome;
    graph: Node;
    panel: HTMLElement;
  },
): HTMLElement[] {
  const { chrome } = context;
  const canvas = html(doc, "div", { class: "canvas" }, [context.graph]);
  const { view } = chrome;
  if (!view.diagramOnly) {
    return [
      ...noticeOf(doc, view),
      headerOf(doc, chrome),
      html(doc, "div", { class: "viz-main" }, [canvas, context.panel]),
    ];
  }
  const show = html(doc, "button", { type: "button", class: "show-controls" }, ["Show controls"]);
  show.setAttribute("data-show-controls", "");
  show.addEventListener("click", () => chrome.showControls());
  return [show, html(doc, "div", { class: "viz-main" }, [canvas])];
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

function initialView(machine: VizMachine | undefined, options: ViewerOptions): ViewState {
  return {
    machineId: machine?.id ?? "",
    selection: null,
    live: null,
    afters: [],
    picked: null,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
    sent: null,
    notice: null,
    blocked: new Map(),
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
  handlers: Pick<LiveContext, "send" | "sendEvent" | "setValue" | "routes">,
): { live?: LiveContext } {
  if (view.live === null) return {};
  return {
    live: {
      state: view.live,
      afters: view.afters,
      picked: view.picked,
      sent: view.sent,
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
  event: string,
  actor: VizActorRef | undefined,
): Extract<VizStep, { kind: "event" }> {
  const payload = payloadFor(machine, event, {
    set: view.values,
    live: view.live,
    afters: view.afters,
  });
  return { kind: "event", event, payload, ...(actor ? { actor } : {}) };
}

/** Takes one live step: and an open payload form closes. */
function stepInto(view: ViewState, driver: VizDriver, step: VizStep): void {
  const length = view.live?.steps.length ?? 0;
  view.live = stepSafely(driver, { before: view.live, step });
  if (view.live.steps.length === length + 1) {
    view.afters.push(view.live.after);
  }
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
/** Sets `view.live` to the state after `steps`. */
function replayInto(view: ViewState, driver: VizDriver, steps: ReadonlyArray<VizStep>): void {
  const played = replay(driver, steps);
  view.live = played.live;
  view.afters = played.afters;
}

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

/** What the header and the layout are built from. */
interface Chrome {
  root: HTMLElement;
  viz: VizDocument;
  machine: VizMachine;
  view: ViewState;
  heading: "h1" | "h2" | "h3";
  render: () => void;
  onNavigate: ViewerOptions["onNavigate"];
  live: boolean;
  showControls: () => void;
}

function headerOf(doc: Document, context: Chrome): HTMLElement {
  const { machine, view, render } = context;
  return html(doc, "header", { class: "viz-header" }, [
    html(doc, context.heading, {}, [`Viz: ${machine.id}`]),
    context.live
      ? null
      : machineSelect(doc, context.viz, {
          view,
          onChange: (id) => {
            view.machineId = id;
            view.selection = null;
            view.notice = null;
            context.onNavigate?.({ machine: id, steps: [], values: encodeValues(view.values) });
            render();
          },
        }),
  ]);
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
    view.blockedFor = null;
    return;
  }
  if (blockedFor !== null && sameBlocked(blockedFor, view)) return;
  view.blockedFor = { live, picked: view.picked, values: view.values };
  view.blocked = blockedEdges(machine, {
    live,
    currents: currentsOf(live, view.picked),
    set: view.values,
    dryRun: (steps) => driver.dryRun?.(steps) ?? [],
    actorOf: (edge) => actorOf(machine, edge, { state: live, picked: view.picked }),
  });
}

/** Everything drawn over the graph: walk marks and selection. */
function markDiagram(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    view: ViewState;
    driver: VizDriver | undefined;
    pick: () => void;
  },
): void {
  const { machine, view } = context;
  updateBlocked(machine, view, context.driver);
  markExplore(root, { machine, blocked: view.blocked, ...liveState(view) });
  const graph = root.querySelector<SVGSVGElement>(".graph");
  if (graph !== null && view.live !== null) {
    drawChildMarkers(graph, {
      machine,
      children: view.live.children,
      picked: view.picked,
      onPick: (child) => {
        view.picked = child;
        view.selection = null;
        view.tab = "step";
        context.pick();
      },
    });
  }
  markSelection(root, view.selection);
}

function markSelection(root: HTMLElement, selection: Selection | null): void {
  const attribute = selection?.kind === "edge" ? "edgeId" : "nodeId";
  for (const element of root.querySelectorAll<SVGGElement>(".graph g")) {
    element.classList.toggle(
      "selected",
      selection !== null && element.dataset[attribute] === selection.id,
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
): { live: VizLiveState; afters: VizLiveStep[][] } {
  let live = driver.reset();
  const afters: VizLiveStep[][] = [];
  for (const step of steps) {
    const length = live.steps.length;
    live = stepSafely(driver, { before: live, step });
    if (live.steps.length === length + 1) {
      afters.push(live.after);
    }
    if (live.last?.error) return { live, afters };
  }
  return { live, afters };
}
