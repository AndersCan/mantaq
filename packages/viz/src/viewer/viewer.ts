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
import { compareKeys, currentsOf, walkedChild } from "./compartments.ts";
import { html } from "./dom.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { availableModes, modeLabel } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { renderPanel } from "./panel.ts";
import { decodeLiveSteps, decodePath, encodeLiveStep, encodeStep } from "../moves.ts";
import type { ExploreStep } from "../moves.ts";
import { explorePanel, markExplore, changedLines } from "./explore.ts";
import type { ExploreContext, ExploreParts } from "./explore.ts";
import { blockedEdges } from "./blocked.ts";
import { decodeValues, encodeValues, payloadFor } from "./fill.ts";
import type { Values } from "./fill.ts";
import { countTitle } from "./pool-count.ts";
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
  /** Live: the child a click in the child graph goes to; null = the lowest key. */
  picked: { map: string; key: string } | null;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Only the diagram and a "Show controls" button are drawn. Starts from `ViewerOptions.diagramOnly`; not saved. */
  diagramOnly: boolean;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | null;
  /** Live: edge id → why its guard blocks it now (see `blocked.ts`). */
  blocked: Map<string, string>;
  /** Field name → the value set in the Context tab; events are sent with it (kept in `?value=`). */
  values: Values;
  /** What `blocked` was computed for; it is recomputed when any of it changes. */
  blockedFor: { live: VizLiveState; picked: ViewState["picked"]; values: Values } | null;
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
  /** Values events are sent with, as `name=<json>` (from `?value=`); the Context tab sets them. */
  values?: ReadonlyArray<string>;
  /** Called after every walk, value or machine change, e.g. to keep the URL shareable. `run` is set when the walk is a run just played from the Runs list. */
  onNavigate?: (where: {
    machine: string;
    steps: string[];
    values: string[];
    run?: string;
  }) => void;
  /**
   * Content under the panel tabs for the selected state or edge (undefined: nothing selected).
   * Called on every panel refresh; may return the same node each time. The live page shows notes here.
   */
  panelFooter?: (selection: Selection | undefined) => Node | undefined;
  /** Live: where each machine's outputs go, so a step can name the machine it told. Unset: output names only. */
  routes?: VizOutputRoutes;
  /** Live only (ignored without `driver`): a first "Screen" tab, open by default, holding what this returns for the cursor's state. */
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
  let back: () => void = () => undefined;
  let redraw: () => void = () => undefined;
  listenOnRoot(root, { back: () => back() });
  listenForPick(root, view, () => redraw());
  watchDriver(view, { driver, redraw: () => redraw() });
  const setDiagramOnly = diagramOnlySwitch(root, view, () => render(), options.diagramOnly);
  function render(): void {
    const machine = viz.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("viz", "not-content");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const mode = effectiveMode(view, machine);
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
      const stepTab = explorePanel(doc, {
        machine,
        path: view.path,
        take,
        rewind,
        ...liveOf(view, { send, play, sendEvent, setValue, routes: options.routes }),
      });
      const details = detailsOf(doc, {
        machine,
        view,
        select: showDetails,
        replay: driver === undefined ? undefined : (steps) => play(steps, undefined, "step"),
      });
      const controls = controlsOf(doc, chrome);
      const footer = options.panelFooter;
      const screen = screenOf(options, view);
      fillPanel(panel, { doc, view, parts: stepTab, details, controls, screen, refresh, footer });
      mark();
    };
    const mark = () => markDiagram(root, { machine, view, driver });
    redraw = refresh;
    const walked = (run?: string) => {
      noticeCleared(root, view);
      navigated(options, { machine, view, run });
      refresh();
    };
    const setValue = valueSetter({ options, machine, view, mark });
    const send = stepSender({ view, driver, walked });
    const sendEvent = (event: string, actor?: VizActorRef) =>
      send(eventStep(machine, view, event, actor));
    const take = (step: ExploreStep) => {
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
    const graph = renderGraph(doc, machine, {
      select: showDetails,
      showDetails,
      mode,
      bare: view.diagramOnly,
    });
    back = () => rewind((view.live?.steps.length ?? view.path.length) - 1);
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
  rest: Pick<Chrome, "mode" | "render" | "setDiagramOnly" | "live">,
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
    replay: Parameters<typeof renderPanel>[2]["replay"];
  },
): HTMLElement {
  return renderPanel(doc, context.machine, {
    selection: context.view.selection,
    select: context.select,
    replay: context.replay,
  });
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
  show.addEventListener("click", () => chrome.setDiagramOnly(false));
  return [show, html(doc, "div", { class: "viz-main" }, [canvas])];
}

function rewindView(view: ViewState, driver: VizDriver | undefined, length: number): void {
  const keep = Math.max(0, length);
  if (driver !== undefined && view.live !== null)
    replayInto(view, driver, view.live.steps.slice(0, keep));
  else view.path = view.path.slice(0, keep);
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
    picked: null,
    tab: options.screen !== undefined ? "screen" : "step",
    diagramOnly: options.diagramOnly ?? false,
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

/** The live driver's part of the panel context. */
function liveOf(
  view: ViewState,
  handlers: Pick<LiveContext, "send" | "play" | "sendEvent" | "setValue" | "routes">,
): { live?: LiveContext } {
  if (view.live === null) return {};
  return {
    live: {
      state: view.live,
      outcomes: view.outcomes,
      afters: view.afters,
      previous: view.previous,
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
  walked: () => void;
}): (step: VizStep) => void {
  const { view, driver, walked } = context;
  return (step) => {
    if (driver === undefined) return;
    stepInto(view, driver, step);
    walked();
  };
}

function noticeCleared(root: HTMLElement, view: ViewState): void {
  view.notice = null;
  root.querySelector("[data-run-missing]")?.remove();
}

/** Tells the host where the walk and the values now are. */
function navigated(
  options: ViewerOptions,
  now: { machine: VizMachine; view: ViewState; run?: string },
): void {
  const { machine, view, run } = now;
  options.onNavigate?.({
    machine: machine.id,
    steps: walkedSteps(machine, view),
    values: encodeValues(view.values),
    ...(run === undefined ? {} : { run }),
  });
}

/** The step a click on `event` sends: its payload comes from the values set in the Context tab. */
function eventStep(
  machine: VizMachine,
  view: ViewState,
  event: string,
  actor: VizActorRef | undefined,
): VizStep {
  const payload = payloadFor(machine, event, {
    set: view.values,
    live: view.live,
    afters: view.afters,
  });
  return { kind: "event", event, payload, ...(actor ? { actor } : {}) };
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
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
/** Sets `view.live` to the state after `steps` and `view.previous` to the context before the last of them. */
function replayInto(view: ViewState, driver: VizDriver, steps: ReadonlyArray<VizStep>): void {
  view.previous = steps.length === 0 ? undefined : replay(driver, steps.slice(0, -1)).live.context;
  const played = replay(driver, steps);
  view.live = played.live;
  view.outcomes = played.outcomes;
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

/** `mantaq:pick-child` walks a live child. For the inspect harness and test tools; not public API. */
function listenForPick(root: HTMLElement, view: ViewState, redraw: () => void): void {
  root.addEventListener("mantaq:pick-child", (event) => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null;
    const { map, key } = (detail ?? {}) as { map?: unknown; key?: unknown };
    const there = view.live?.children.some((c) => c.map === map && c.key === key);
    if (there !== true || typeof map !== "string" || typeof key !== "string") return;
    view.picked = { map, key };
    view.tab = "step";
    redraw();
  });
}

/** A pick of a child that is gone is dropped. */
function dropGonePick(view: ViewState): void {
  const { picked } = view;
  const there = view.live?.children.some((c) => c.map === picked?.map && c.key === picked.key);
  if (picked !== null && there !== true) view.picked = null;
}

/** Listeners that outlive each render: ArrowLeft steps back, and the button label follows fullscreen. */
function listenOnRoot(root: HTMLElement, keys: { back: () => void }): void {
  root.addEventListener("keydown", (event) => {
    if (!("key" in event) || isTextControl(event.target)) return;
    if (event.key === "ArrowLeft") keys.back();
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
            view.path = [];
            view.notice = null;
            context.onNavigate?.({ machine: id, steps: [], values: encodeValues(view.values) });
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
  },
): void {
  const { machine, view } = context;
  updateBlocked(machine, view, context.driver);
  markExplore(root, { machine, path: view.path, blocked: view.blocked, ...liveState(view) });
  const graph = root.querySelector<SVGSVGElement>("svg");
  if (graph !== null) markPools(root, { machine, view });
  markSelection(root, view.selection);
}

/** Each map frame is titled with its live count of children; `data-children` lists them for the inspect harness. */
function markPools(root: HTMLElement, context: { machine: VizMachine; view: ViewState }): void {
  const { machine, view } = context;
  const { live } = view;
  if (live === null) return;
  for (const map of machine.maps) {
    const frame = root.querySelector(`.graph g.region[data-map="${map}"]`);
    const title = frame?.querySelector(":scope > text");
    if (title !== null && title !== undefined) title.textContent = countTitle(machine, live, map);
    const children = live.children
      .filter((child) => child.map === map)
      .sort((a, b) => compareKeys(a.key, b.key))
      .map((child) => ({ key: child.key, state: child.state }));
    frame?.setAttribute("data-children", JSON.stringify(children));
  }
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
