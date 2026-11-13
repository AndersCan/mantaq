import type {
  VizDocument,
  VizActorRef,
  VizLiveChild,
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
import { currentsOf } from "./compartments.ts";
import { html } from "./dom.ts";
import { changesSection } from "./changes.ts";
import type { ChangesOption } from "./changes.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { availableModes, modeLabel } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { renderPanel } from "./panel.ts";
import {
  decodeLiveSteps,
  decodePath,
  encodeLiveStep,
  encodeStep,
  asksForPayload,
} from "../moves.ts";
import type { ExploreStep } from "../moves.ts";
import { pathTo } from "../findings.ts";
import { clickStep, explorePanel, markExplore, changedLines } from "./explore.ts";
import type { ExploreContext, ExploreParts } from "./explore.ts";
import { blockedEdges } from "./blocked.ts";
import { drawChildMarkers } from "./markers.ts";
import { removeSheets, showPayloadSheet } from "./payload-sheet.ts";
import { keyLine } from "./key.ts";
import {
  dotKey,
  markSystem,
  renderSystem,
  sendsLines,
  systemDetails,
  systemFor,
  systemPrefix,
} from "./system.ts";
import type { OpenTarget, SystemCallbacks, SystemSelection } from "./system.ts";
import type { MachineSystem } from "../system.ts";
import { tabs } from "./tabs.ts";
import type { Tab } from "./tabs.ts";

const DOCS_URL = "https://anderscan.github.io/mantaq/guides/visualizer/";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  /** null = use the machine's best available mode. */
  coverage: CoverageMode | null;
  /** Steps taken from the initial state. */
  path: ExploreStep[];
  /** Set while a driver runs the actor. */
  live: VizLiveState | null;
  /** Entry i is the driver's `last` for `live.steps[i]`. */
  outcomes: Array<VizLiveStep | null>;
  /** Entry i is what the driver reported moving after `live.steps[i]` (its `after`) when that step was taken. */
  afters: VizLiveStep[][];
  /** Context before the last live step; undefined when no step ran. */
  previous: VizJson | undefined;
  /** Live: the event whose payload form is open. */
  composing: string | null;
  /** Live: the region the open payload form sends to; undefined = the machine itself. */
  composingActor: VizActorRef | undefined;
  /** The "Events and time" fold is open; it stays as the user left it across steps and Back. */
  eventsOpen: boolean;
  /** Live: the child a click in the child graph goes to; null = the one that started first. */
  picked: { map: string; key: string } | null;
  /** True only right after a step or an effect result: markers slide and new ones grow in. */
  motion: boolean;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Only the diagram and a "Show controls" button are drawn. Starts from `ViewerOptions.diagramOnly`; not saved. */
  diagramOnly: boolean;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | null;
  /** A machine whose parts talk opens on the system view; true once the reader opened a part in the diagram. */
  drilled: boolean;
  /** The clicked arrow or box in the system view; kept while the diagram is open. */
  systemSelection: SystemSelection | null;
  /** Live: edge id → why its guard blocks it now (see `blocked.ts`). */
  blocked: Map<string, string>;
  /** What `blocked` was computed for; it is recomputed when either changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"] } | null;
}

type PanelTab = "screen" | "step" | "context" | "path" | "details" | "controls";

function effectiveMode(view: ViewState, machine: VizMachine): CoverageMode {
  const modes = availableModes(machine);
  if (view.coverage === "off") return "off";
  if (view.coverage !== null && modes.includes(view.coverage)) return view.coverage;
  return modes[0] ?? "off";
}

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

function isMode(value: string): value is CoverageMode {
  return value === "off" || value === "run" || value === "tests" || value === "reached";
}

function coveragePicker(
  doc: Document,
  context: { machine: VizMachine; mode: CoverageMode; onChange: (mode: CoverageMode) => void },
): HTMLLabelElement | null {
  const modes = availableModes(context.machine);
  if (modes.length === 0) return null;
  const select = html(
    doc,
    "select",
    { class: "coverage-mode" },
    [...modes, "off" as const].map((mode) =>
      html(doc, "option", { value: mode, selected: mode === context.mode ? "" : null }, [
        modeLabel(mode, context.machine),
      ]),
    ),
  );
  select.addEventListener("change", () => {
    if (isMode(select.value)) context.onChange(select.value);
  });
  return html(doc, "label", {}, ["Coverage from ", select]);
}

export interface ViewerOptions {
  /** Title element. Embedded viewers use `h2`/`h3` to fit the host page's outline. */
  heading?: "h1" | "h2" | "h3";
  /** Machine to show first; defaults to the first one. */
  machine?: string;
  /** Encoded steps to open on (from `?step=`), in the shown machine. With a `driver`, live steps replayed through it. */
  steps?: ReadonlyArray<string>;
  /**
   * Runs the machine for real: steps go to the driver and the cursor follows its state.
   * The driver runs one machine, so the machine picker is hidden.
   */
  driver?: VizDriver;
  /** Name of a run in the shown machine's `runs` to open on (from `?run=`). Wins over `steps`. Replays only with a `driver`. */
  run?: string;
  /** Called after every walk or machine change, e.g. to keep the URL shareable. `run` is set when the walk is a run just played from the Runs list. */
  onNavigate?: (where: { machine: string; steps: string[]; run?: string }) => void;
  /**
   * Content under the panel tabs for the selected state or edge (undefined: nothing selected).
   * Called on every panel refresh; may return the same node each time. The live page shows notes here.
   */
  panelFooter?: (selection: Selection | undefined) => Node | undefined;
  /**
   * Marks what changed in machine `machine` since `before`: added states and arrows are
   * outlined, and a "What changed" list names them and what was removed.
   * `onSeen` runs when the reader presses "Mark as seen"; the marks then clear.
   * Unset, another machine shown, or nothing changed: no marks, no list.
   */
  changes?: ChangesOption;
  /** Live: where each machine's outputs go, so a step can name the machine it told. Unset: output names only. */
  routes?: VizOutputRoutes;
  /** Live only (ignored without `driver`): a first "Screen" tab, open by default, holding what this returns for the cursor's state. While it is open, clicking a state walks there. */
  screen?: (state: VizLiveState) => Node;
  /** Open with only the diagram and a "Show controls" button, e.g. a docs page that explains one idea. Default false. */
  diagramOnly?: boolean;
}

/**
 * Mount a viewer for an viz document into `root`. Walking the graph moves a
 * cursor over the drawn edges; no actor runs. The document is the only input.
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
  // Re-bound by each render: ArrowLeft steps back.
  let back: () => void = () => undefined;
  let redraw: () => void = () => undefined;
  listenOnRoot(root, { back: () => back(), unpick: () => unpickIn(view, redraw) });
  const changing = { option: options.changes, seen: false, render: () => render() };
  watchDriver(view, { driver, redraw: () => redraw() });
  const setDiagramOnly = diagramOnlySwitch(root, view, () => render(), options.diagramOnly);
  function render(): void {
    const machine = viz.machines.find((candidate) => candidate.id === view.machineId);
    removeSheets(root);
    root.replaceChildren();
    root.classList.add("viz", "not-content");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const mode = effectiveMode(view, machine);
    const system = systemFor(machine);
    const inSystem = system !== null && !view.drilled;
    root.classList.toggle("coverage-on", mode !== "off");
    root.classList.toggle("diagram-only", view.diagramOnly);
    const chrome = chromeOf(
      { root, viz, machine, view, options },
      { mode, render, setDiagramOnly, live: driver !== undefined },
    );
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
    const refresh = () => {
      dropGonePick(view);
      const parts = explorePanel(doc, {
        machine,
        path: view.path,
        take,
        rewind,
        ...liveOf(view, { send, play, compose, routes: options.routes }),
      });
      const details = detailsOf(doc, {
        machine,
        view,
        system: inSystem ? system : null,
        sends: system,
        open,
        select,
        replay: driver === undefined ? undefined : (steps) => play(steps, undefined, "step"),
      });
      const controls = controlsOf(doc, chrome);
      const footer = options.panelFooter;
      const screen = screenOf(options, view);
      fillPanel(panel, { doc, view, parts, details, controls, screen, refresh, footer });
      if (inSystem) markSystemView(root, { machine, system, view, send, compose });
      else markDiagram(root, { machine, view, driver, send, compose, refresh });
    };
    redraw = refresh;
    const walked = (run?: string) => {
      view.notice = null;
      root.querySelector("[data-run-missing]")?.remove();
      const steps = walkedSteps(machine, view);
      options.onNavigate?.({ machine: machine.id, steps, ...(run === undefined ? {} : { run }) });
      refresh();
    };
    const send = (step: VizStep) => {
      if (driver === undefined) return;
      stepInto(view, driver, step);
      walked();
    };
    const compose = composer(view, refresh);
    const take = (step: ExploreStep) => {
      if (driver !== undefined) return liveTake(machine, step, { send, compose, view });
      view.path = [...view.path, step];
      walked();
    };
    const play = (steps: ReadonlyArray<VizStep>, run?: string, tab?: ViewState["tab"]) => {
      if (tab !== undefined) view.tab = tab;
      if (driver !== undefined) replayInto(view, driver, steps);
      walked(run);
    };
    const rewind = (length: number) => {
      rewindView(view, driver, length);
      walked();
    };
    const showDetails = detailsShower({ view, panel, refresh });
    // A click on a next step takes it; either way the clicked element's details show.
    const select = (selection: Selection) => {
      if (openBlocked(machine, view, selection, compose)) return;
      const step = clickStep(machine, { path: view.path, selection, ...liveState(view) });
      if (step !== null) view.selection = selection;
      if (step !== null) return take(step);
      const walk = screenWalk({ machine, view, driver, selection });
      return walk === null ? showDetails(selection) : play(walk, undefined, "screen");
    };
    const open = openIn(root, view, () => render());
    const live = driver === undefined ? null : { send, compose };
    const graph = inSystem
      ? renderSystem(doc, machine, system, {
          ...systemCallbacks({ machine, view, refresh, live }),
          narrow: root.clientWidth > 0 && root.clientWidth < 560,
        })
      : renderGraph(doc, machine, { select, showDetails, mode, bare: view.diagramOnly });
    const changes = changesSection(doc, machine, graph, changing);
    back = () => rewind((view.live?.steps.length ?? view.path.length) - 1);
    root.append(...layoutOf(doc, { chrome, graph, panel, changes }));
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
  rest: Pick<Chrome, "mode" | "render" | "setDiagramOnly" | "live">,
): Chrome {
  const { options, ...shared } = from;
  return { ...shared, ...rest, heading: options.heading ?? "h1", onNavigate: options.onNavigate };
}

/** The system view's clicks; the entry lines send only when a driver runs. */
function systemCallbacks(context: {
  machine: VizMachine;
  view: ViewState;
  refresh: () => void;
  live: Pick<LiveContext, "send" | "compose"> | null;
}): SystemCallbacks {
  const { machine, view, live } = context;
  const select = systemSelector(view, context.refresh);
  if (live === null) return { select };
  return {
    select,
    send: ({ event, to }) =>
      sendEvent(machine, event, {
        actor: to === "" ? undefined : { region: to },
        ...live,
      }),
  };
}

/** The line under the system diagram: the prefix its event names share, and what the child dots mean when a driver draws them. */
function systemKey(
  doc: Document,
  context: { machine: VizMachine; system: MachineSystem | null; live: VizLiveState | null },
): HTMLElement | null {
  const { machine, system, live } = context;
  if (system === null) return null;
  const prefix = systemPrefix(system);
  const dotItem = dotKey(machine, { system, live });
  return keyLine(doc, [
    ...(prefix === "" ? [] : [`events: ${prefix}*`]),
    ...(dotItem === null ? [] : [dotItem]),
  ]);
}

/** A click on an arrow or box in the system view: its details show, nothing is walked. */
function systemSelector(
  view: ViewState,
  refresh: () => void,
): (selection: SystemSelection) => void {
  return (selection) => {
    view.systemSelection = selection;
    view.tab = "details";
    refresh();
  };
}

/** Open: the diagram, on the target, without walking (a click on the diagram would walk). */
function openIn(
  root: HTMLElement,
  view: ViewState,
  render: () => void,
): (target: OpenTarget) => void {
  return (target) => {
    view.drilled = true;
    view.selection = target;
    view.tab = "details";
    render();
    const element = root.querySelector<SVGGElement>(".graph g.selected");
    if (typeof element?.scrollIntoView === "function")
      element.scrollIntoView({ block: "nearest", inline: "center" });
    root.querySelector<HTMLElement>("[data-system-back]")?.focus({ preventScroll: true });
  };
}

/** The Details tab: the clicked arrow or box in the system view, else the diagram's selection. */
function detailsOf(
  doc: Document,
  context: {
    machine: VizMachine;
    view: ViewState;
    /** Set while the system view shows. */
    system: MachineSystem | null;
    /** Set when the machine has a system, shown or not. */
    sends: MachineSystem | null;
    open: (target: OpenTarget) => void;
    select: (selection: Selection) => void;
    replay: Parameters<typeof renderPanel>[2]["replay"];
  },
): HTMLElement {
  const { machine, view, system, sends, open } = context;
  const chosen = view.systemSelection;
  const shown =
    system === null || chosen === null
      ? null
      : systemDetails(doc, { machine, system, selection: chosen, live: view.live, open });
  return (
    shown ??
    renderPanel(doc, machine, {
      selection: view.selection,
      select: context.select,
      replay: context.replay,
      sends:
        sends === null
          ? undefined
          : (edge) => sendsLines(doc, { machine, system: sends, edge, open }),
    })
  );
}

/** Turns Diagram only on or off (Show controls opens the Step tab when the page asked for Diagram only, else Controls), then puts focus on the Step tab or the button that undoes it. */
function diagramOnlySwitch(
  root: HTMLElement,
  view: ViewState,
  render: () => void,
  fromOption: boolean | undefined,
): (on: boolean) => void {
  return (on) => {
    view.diagramOnly = on;
    const toStep = !on && fromOption === true;
    if (!on) view.tab = toStep ? "step" : "controls";
    render();
    const target = on
      ? "[data-show-controls]"
      : toStep
        ? '[role="tab"][aria-selected="true"]'
        : "[data-diagram-only]";
    root.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  };
}

/** Everything the viewer draws under its root: the controls and panel, or with Diagram only just the canvas. */
function layoutOf(
  doc: Document,
  context: {
    chrome: Chrome;
    graph: Node;
    panel: HTMLElement;
    changes: HTMLElement[];
  },
): HTMLElement[] {
  const { chrome } = context;
  const canvas = html(doc, "div", { class: "canvas" }, [context.graph]);
  const { view } = chrome;
  if (!view.diagramOnly) {
    return [
      ...noticeOf(doc, view),
      headerOf(doc, chrome),
      ...context.changes,
      html(doc, "div", { class: "viz-main" }, [canvas, context.panel]),
    ];
  }
  const show = html(doc, "button", { type: "button", class: "show-controls" }, ["Show controls"]);
  show.setAttribute("data-show-controls", "");
  show.addEventListener("click", () => chrome.setDiagramOnly(false));
  return [show, html(doc, "div", { class: "viz-main" }, [canvas])];
}

function rewindView(view: ViewState, driver: VizDriver | undefined, length: number): void {
  const keep = Math.max(0, length);
  if (driver !== undefined && view.live !== null)
    replayInto(view, driver, view.live.steps.slice(0, keep));
  else view.path = view.path.slice(0, keep);
}

function composer(view: ViewState, refresh: () => void) {
  return (event: string | null, actor?: VizActorRef) => {
    view.composing = event;
    view.composingActor = event === null ? undefined : actor;
    refresh();
  };
}

function detailsShower(context: { view: ViewState; panel: HTMLElement; refresh: () => void }) {
  const { view, panel, refresh } = context;
  return (selection: Selection, shown?: { findings: boolean }): void => {
    view.selection = selection;
    view.tab = "details";
    refresh();
    if (shown?.findings === true)
      panel.querySelector<HTMLElement>(".state-findings h4")?.focus({ preventScroll: true });
  };
}

function screenOf(options: ViewerOptions, view: ViewState): Node | undefined {
  return view.live === null ? undefined : options.screen?.(view.live);
}

/** With Screen open, a click on any state walks the shortest known walk there; otherwise null. */
function screenWalk(context: {
  machine: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
  selection: Selection;
}): VizStep[] | null {
  const { machine, view, driver, selection } = context;
  if (view.tab !== "screen" || driver === undefined || selection.kind !== "state") return null;
  if (selection.id === view.live?.state) return null;
  return walkTo({ machine, view, driver }, selection.id);
}

/** The shortest known walk to state `id`, cut at the first step that lands there; null when there is none. */
function walkTo(
  context: { machine: VizMachine; view: ViewState; driver: VizDriver },
  id: string,
): VizStep[] | null {
  const { machine, view, driver } = context;
  if (id === machine.initial) return [];
  const steps = pathTo(machine, id);
  if (steps === null) return null;
  let live = driver.reset();
  for (const [index, step] of steps.entries()) {
    live = stepSafely(driver, { before: live, step });
    if (live.state === id) return steps.slice(0, index + 1);
  }
  replayInto(view, driver, view.live?.steps ?? []);
  return null;
}

function initialView(machine: VizMachine | undefined, options: ViewerOptions): ViewState {
  return {
    machineId: machine?.id ?? "",
    selection: null,
    coverage: null,
    path:
      machine === undefined || options.driver !== undefined
        ? []
        : decodePath(machine, options.steps ?? []),
    live: null,
    outcomes: [],
    afters: [],
    previous: undefined,
    composing: null,
    composingActor: undefined,
    eventsOpen: false,
    picked: null,
    motion: false,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
    notice: null,
    drilled: false,
    systemSelection: null,
    blocked: new Map(),
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

/** Step, Context (live only), Path, Details and Controls as tabs; Context counts the lines the last step changed. */
function panelTabs(
  doc: Document,
  context: {
    view: ViewState;
    parts: ExploreParts;
    details: HTMLElement;
    controls: HTMLElement;
    screen: Node | undefined;
    refresh: () => void;
  },
): HTMLElement {
  const { view, parts } = context;
  const changed = view.live === null ? 0 : changedLines(view.live, view.previous);
  const all: Array<Tab<PanelTab> | null> = [
    context.screen === undefined
      ? null
      : { id: "screen", label: "Screen", content: html(doc, "div", {}, [context.screen]) },
    { id: "step", label: "Step", content: parts.step },
    parts.context === null
      ? null
      : {
          id: "context",
          label: changed === 0 ? "Context" : `Context (${changed} changed)`,
          content: parts.context,
        },
    { id: "path", label: "Path", content: parts.path },
    { id: "details", label: "Details", content: context.details },
    { id: "controls", label: "Controls", content: context.controls },
  ];
  const shown = all.filter((tab): tab is Tab<PanelTab> => tab !== null);
  const active = shown.some((tab) => tab.id === view.tab) ? view.tab : "step";
  return tabs(doc, {
    tabs: shown,
    active,
    onSelect: (id) => {
      view.tab = id;
      context.refresh();
    },
  });
}

/** The live driver's part of the panel context, and the fold's open state, which lives in the view. */
function liveOf(
  view: ViewState,
  handlers: Pick<LiveContext, "send" | "play" | "compose" | "routes">,
): Pick<ExploreContext, "events"> & { live?: LiveContext } {
  const events = {
    open: view.eventsOpen,
    onToggle: (open: boolean) => {
      view.eventsOpen = open;
    },
  };
  if (view.live === null) return { events };
  return {
    events,
    live: {
      state: view.live,
      outcomes: view.outcomes,
      afters: view.afters,
      previous: view.previous,
      ...handlers,
    },
  };
}

/** Who an edge click sends to: the picked child, else the one that started first; "none" = no such child in the edge's source state. */
function actorOf(
  machine: VizMachine,
  edge: VizEdge,
  live: { children: ReadonlyArray<VizLiveChild>; picked: { map: string; key: string } | null },
): VizActorRef | undefined | "none" {
  const region = scopeOf(edge.from);
  if (machine.maps.includes(region)) {
    const { picked } = live;
    const inSource = live.children.filter((child) => child.state === edge.from);
    const target =
      picked === null
        ? inSource.reduce<VizLiveChild | undefined>(
            (first, each) => (first === undefined || each.since < first.since ? each : first),
            undefined,
          )
        : inSource.find((each) => each.map === picked.map && each.key === picked.key);
    return target === undefined ? "none" : { map: target.map, key: target.key };
  }
  return region === "" ? undefined : { region };
}

/** A live click on an edge sends at once when the event has no payload; otherwise it opens the form, and nothing is sent until Send. */
function liveTake(
  machine: VizMachine,
  step: ExploreStep,
  handlers: Pick<LiveContext, "send" | "compose"> & { view: ViewState },
): void {
  const edge = machine.edges.find((each) => each.id === step.edge);
  if (edge === undefined) return;
  const actor = actorOf(machine, edge, {
    children: handlers.view.live?.children ?? [],
    picked: handlers.view.picked,
  });
  if (actor === "none") return;
  sendEvent(machine, edge.event, { actor, ...handlers });
}

function sendEvent(
  machine: VizMachine,
  event: string,
  handlers: Pick<LiveContext, "send" | "compose"> & {
    actor: VizActorRef | undefined;
  },
): void {
  const { actor } = handlers;
  const withActor = actor ? { actor } : {};
  if (!asksForPayload(machine, event)) {
    handlers.send({ kind: "event", event, payload: null, ...withActor });
    return;
  }
  handlers.compose(event, actor);
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
    view.motion = true;
    context.redraw();
  });
}

function walkedSteps(machine: VizMachine, view: ViewState): string[] {
  return view.live === null
    ? view.path.map((step) => encodeStep(machine, step))
    : view.live.steps.map(encodeLiveStep);
}

/** Takes one live step: the context before it becomes `previous`, and an open payload form closes. */
function stepInto(view: ViewState, driver: VizDriver, step: VizStep): void {
  view.previous = view.live?.context;
  const length = view.live?.steps.length ?? 0;
  view.live = stepSafely(driver, { before: view.live, step });
  if (view.live.steps.length === length + 1) {
    view.outcomes.push(view.live.last);
    view.afters.push(view.live.after);
  }
  view.motion = true;
  view.composing = null;
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
/** Sets `view.live` to the state after `steps` and `view.previous` to the context before the last of them. */
function replayInto(view: ViewState, driver: VizDriver, steps: ReadonlyArray<VizStep>): void {
  view.previous = steps.length === 0 ? undefined : replay(driver, steps.slice(0, -1)).live.context;
  const played = replay(driver, steps);
  view.live = played.live;
  view.outcomes = played.outcomes;
  view.afters = played.afters;
  view.composing = null;
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

function setFullscreenLabel(button: HTMLButtonElement, active: boolean): void {
  button.textContent = active ? "Exit full screen" : "Full screen";
  button.setAttribute("aria-pressed", String(active));
}

function fillPanel(
  panel: HTMLElement,
  context: Parameters<typeof panelTabs>[1] & {
    doc: Document;
    footer: ViewerOptions["panelFooter"];
  },
): void {
  const { doc, footer, ...tabs } = context;
  const node = footer?.(tabs.view.selection ?? undefined);
  panel.replaceChildren(panelTabs(doc, tabs), ...(node === undefined ? [] : [node]));
}

/** Arrow keys belong to the control while typing or choosing in it. */
function isTextControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** A pick of a child that is gone is dropped. */
function dropGonePick(view: ViewState): void {
  const { picked } = view;
  const there = view.live?.children.some((c) => c.map === picked?.map && c.key === picked.key);
  if (picked !== null && there !== true) view.picked = null;
}

function unpickIn(view: ViewState, redraw: () => void): void {
  if (view.picked === null) return;
  view.picked = null;
  redraw();
}

/** Listeners that outlive each render: ArrowLeft steps back, and the button label follows fullscreen. */
function listenOnRoot(root: HTMLElement, keys: { back: () => void; unpick: () => void }): void {
  root.addEventListener("keydown", (event) => {
    if (!("key" in event) || isTextControl(event.target)) return;
    if (event.key === "ArrowLeft") keys.back();
    const inDialog =
      event.target instanceof Element && event.target.closest('[role="dialog"]') !== null;
    if (event.key === "Escape" && !inDialog) keys.unpick();
  });
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

/** What the header and the Controls tab are built from. */
interface Chrome {
  root: HTMLElement;
  viz: VizDocument;
  machine: VizMachine;
  view: ViewState;
  heading: "h1" | "h2" | "h3";
  mode: CoverageMode;
  render: () => void;
  onNavigate: ViewerOptions["onNavigate"];
  live: boolean;
  setDiagramOnly: (on: boolean) => void;
}

/** "← System": back from a part's diagram to the system view, the system selection kept. Only after Open. */
function backToSystem(doc: Document, context: Chrome): HTMLElement | null {
  const { view, machine } = context;
  if (!view.drilled || systemFor(machine) === null) return null;
  const button = html(doc, "button", { type: "button", "data-system-back": "" }, ["← System"]);
  button.addEventListener("click", () => {
    view.drilled = false;
    context.render();
    context.root
      .querySelector<HTMLElement>(".graph .selected[tabindex]")
      ?.focus({ preventScroll: true });
  });
  return button;
}

function headerOf(doc: Document, context: Chrome): HTMLElement {
  const { machine, view, render } = context;
  return html(doc, "header", { class: "viz-header" }, [
    backToSystem(doc, context),
    html(doc, context.heading, {}, [`Viz: ${machine.id}`]),
    context.live
      ? null
      : machineSelect(doc, context.viz, {
          view,
          onChange: (id) => {
            view.machineId = id;
            view.selection = null;
            view.drilled = false;
            view.systemSelection = null;
            view.path = [];
            view.notice = null;
            context.onNavigate?.({ machine: id, steps: [] });
            render();
          },
        }),
    html(
      doc,
      "a",
      { class: "help-link", href: DOCS_URL, target: "_blank", rel: "noopener noreferrer" },
      ["How this works"],
    ),
  ]);
}

/** The Controls tab: Coverage from (when a mode has data), Full screen (where the browser allows), Diagram only. */
function controlsOf(doc: Document, context: Chrome): HTMLElement {
  const { root, machine, view, render } = context;
  const diagramOnly = html(doc, "button", { type: "button", class: "diagram-only-toggle" }, [
    "Diagram only",
  ]);
  diagramOnly.setAttribute("data-diagram-only", "");
  diagramOnly.addEventListener("click", () => context.setDiagramOnly(true));
  return html(doc, "div", { class: "controls" }, [
    coveragePicker(doc, {
      machine,
      mode: context.mode,
      onChange: (next) => {
        view.coverage = next;
        render();
      },
    }),
    fullscreenButton(doc, root),
    diagramOnly,
  ]);
}

/** The system view's marks, and the payload sheet, which a send from the Step tab opens as in the diagram. */
function markSystemView(
  root: HTMLElement,
  context: { machine: VizMachine; system: MachineSystem; view: ViewState } & Pick<
    LiveContext,
    "send" | "compose"
  >,
): void {
  const { machine, system, view } = context;
  markSystem(root, { machine, system, live: view.live, selection: view.systemSelection });
  const canvas = root.querySelector(".canvas");
  const doc = root.ownerDocument;
  canvas?.querySelector("[data-viz-key]")?.remove();
  const key = view.diagramOnly ? null : systemKey(doc, { machine, system, live: view.live });
  if (key !== null) canvas?.append(key);
  showPayloadSheet(root, { ...context, ...view });
}

/** Recomputes the blocked arrows when the live state or the picked child changed; no `dryRun` blocks nothing. */
function updateBlocked(machine: VizMachine, view: ViewState, driver: VizDriver | undefined): void {
  const { live, blockedFor } = view;
  if (live === null || driver?.dryRun === undefined) {
    view.blocked = new Map();
    view.blockedFor = null;
    return;
  }
  const same =
    blockedFor?.live === live &&
    blockedFor.picked?.map === view.picked?.map &&
    blockedFor.picked?.key === view.picked?.key;
  if (same) return;
  view.blockedFor = { live, picked: view.picked };
  view.blocked = blockedEdges(machine, {
    live,
    currents: currentsOf(live, view.picked),
    dryRun: (steps) => driver.dryRun?.(steps) ?? [],
    actorOf: (edge) => actorOf(machine, edge, { children: live.children, picked: view.picked }),
  });
}

/** A click on a blocked edge opens the reason where the form would be, and sends nothing. Returns whether it was one. */
function openBlocked(
  machine: VizMachine,
  view: ViewState,
  selection: Selection,
  compose: (event: string | null, actor?: VizActorRef) => void,
): boolean {
  if (selection.kind !== "edge" || !view.blocked.has(selection.id)) return false;
  const edge = machine.edges.find((each) => each.id === selection.id);
  const actor =
    edge === undefined
      ? "none"
      : actorOf(machine, edge, { children: view.live?.children ?? [], picked: view.picked });
  if (edge !== undefined && actor !== "none") compose(edge.event, actor);
  return true;
}

/** Everything drawn over the graph: walk marks, selection, and the edge of the open payload sheet. */
function markDiagram(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    view: ViewState;
    driver: VizDriver | undefined;
    refresh: () => void;
  } & Pick<LiveContext, "send" | "compose">,
): void {
  const { machine, view } = context;
  updateBlocked(machine, view, context.driver);
  markExplore(root, { machine, path: view.path, blocked: view.blocked, ...liveState(view) });
  const graph = root.querySelector<SVGSVGElement>("svg");
  if (view.live !== null && graph !== null) {
    drawChildMarkers(graph, {
      machine,
      children: view.live.children,
      picked: view.picked,
      motion: view.motion,
      onPick: (child) => {
        view.picked = child;
        context.refresh();
      },
    });
    view.motion = false;
  }
  markSelection(root, view.selection);
  showPayloadSheet(root, { ...context, ...view });
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
): { live: VizLiveState; outcomes: Array<VizLiveStep | null>; afters: VizLiveStep[][] } {
  let live = driver.reset();
  const outcomes: Array<VizLiveStep | null> = [];
  const afters: VizLiveStep[][] = [];
  for (const step of steps) {
    const length = live.steps.length;
    live = stepSafely(driver, { before: live, step });
    if (live.steps.length === length + 1) {
      outcomes.push(live.last);
      afters.push(live.after);
    }
    if (live.last?.error) return { live, outcomes, afters };
  }
  return { live, outcomes, afters };
}
