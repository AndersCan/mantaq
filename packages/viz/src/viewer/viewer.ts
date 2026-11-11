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
  payloadSamples,
} from "../moves.ts";
import type { ExploreStep } from "../moves.ts";
import { clickStep, explorePanel, markExplore, changedLines } from "./explore.ts";
import type { ExploreContext, ExploreParts } from "./explore.ts";
import { freshKeys, knownPayload } from "./fill.ts";
import { drawChildMarkers } from "./markers.ts";
import { showPayloadSheet } from "./payload-sheet.ts";
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
  /** Live: an edge click opens the payload form instead of sending a known value. */
  alwaysAsk: boolean;
  /** The "Events and time" fold is open; it stays as the user left it across steps and Back. */
  eventsOpen: boolean;
  /** Live: the child a click in the child graph goes to; null = the one that started first. */
  picked: { map: string; key: string } | null;
  /** True only right after a step or an effect result: markers slide and new ones grow in. */
  motion: boolean;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Only the diagram and a "Show controls" button are drawn. View state: not an option, not saved. */
  diagramOnly: boolean;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | null;
}

type PanelTab = "step" | "context" | "path" | "details" | "controls";

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

  const setDiagramOnly = diagramOnlySwitch(root, view, () => render());
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
    const chrome: Chrome = {
      root,
      viz,
      machine,
      view,
      heading: options.heading ?? "h1",
      mode,
      render,
      onNavigate: options.onNavigate,
      live: driver !== undefined,
      setDiagramOnly,
    };
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
      const details = renderPanel(doc, machine, {
        selection: view.selection,
        select,
        replay: driver === undefined ? undefined : (steps) => play(steps, undefined, "step"),
      });
      const controls = controlsOf(doc, chrome);
      const footer = options.panelFooter;
      fillPanel(panel, { doc, view, parts, details, controls, refresh, footer });
      markDiagram(root, { machine, view, send, compose, refresh });
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
    const compose = (event: string | null, actor?: VizActorRef) => {
      view.composing = event;
      view.composingActor = event === null ? undefined : actor;
      refresh();
    };
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
    const showDetails = (selection: Selection, shown?: { findings: boolean }) => {
      view.selection = selection;
      view.tab = "details";
      refresh();
      if (shown?.findings === true)
        panel.querySelector<HTMLElement>(".state-findings h4")?.focus({ preventScroll: true });
    };
    // A click on a next step takes it; either way the clicked element's details show.
    const select = (selection: Selection) => {
      const step = clickStep(machine, { path: view.path, selection, ...liveState(view) });
      if (step !== null) view.selection = selection;
      return step === null ? showDetails(selection) : take(step);
    };
    const graph = renderGraph(doc, machine, { select, showDetails, mode });
    const changes = changesSection(doc, machine, graph, changing);
    back = () => rewind((view.live?.steps.length ?? view.path.length) - 1);
    root.append(...layoutOf(doc, { chrome, graph, panel, changes }));
    refresh();
  }

  render();
}

/** Turns Diagram only on or off, then puts focus on the button that undoes it. */
function diagramOnlySwitch(
  root: HTMLElement,
  view: ViewState,
  render: () => void,
): (on: boolean) => void {
  return (on) => {
    view.diagramOnly = on;
    if (!on) view.tab = "controls";
    render();
    root
      .querySelector<HTMLElement>(on ? "[data-show-controls]" : "[data-diagram-only]")
      ?.focus({ preventScroll: true });
  };
}

/** Everything the viewer draws under its root: the controls and panel, or with Diagram only just the canvas. */
function layoutOf(
  doc: Document,
  context: { chrome: Chrome; graph: Node; panel: HTMLElement; changes: HTMLElement[] },
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
    alwaysAsk: false,
    eventsOpen: false,
    picked: null,
    motion: false,
    tab: "step",
    diagramOnly: false,
    notice: null,
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
    refresh: () => void;
  },
): HTMLElement {
  const { view, parts } = context;
  const changed = view.live === null ? 0 : changedLines(view.live, view.previous);
  const all: Array<Tab<PanelTab> | null> = [
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

function knownFor(machine: VizMachine, event: string, view: ViewState) {
  const known = knownPayload(machine.events.find((each) => each.id === event)?.payload ?? null, {
    event,
    samples: payloadSamples(machine, event),
    steps: view.live?.steps ?? [],
  });
  if (known === undefined || view.live === null) return known;
  return { payload: freshKeys(known.payload, { event, state: view.live }) };
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

/** A live click on an edge sends at once with a payload the page already knows; Always ask (or nothing known) opens the form. */
function liveTake(
  machine: VizMachine,
  step: ExploreStep,
  handlers: Pick<LiveContext, "send" | "compose"> & { view: ViewState },
): void {
  const edge = machine.edges.find((each) => each.id === step.edge);
  if (edge === undefined) return;
  const { event } = edge;
  const actor = actorOf(machine, edge, {
    children: handlers.view.live?.children ?? [],
    picked: handlers.view.picked,
  });
  if (actor === "none") return;
  const withActor = actor ? { actor } : {};
  if (!asksForPayload(machine, event)) {
    handlers.send({ kind: "event", event, payload: null, ...withActor });
    return;
  }
  const known = handlers.view.alwaysAsk ? undefined : knownFor(machine, event, handlers.view);
  if (known === undefined) handlers.compose(event, actor);
  else handlers.send({ kind: "event", event, payload: known.payload, ...withActor });
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

function alwaysAskButton(doc: Document, view: ViewState): HTMLElement {
  const button = html(
    doc,
    "button",
    {
      type: "button",
      class: "always-ask",
      "data-always-ask": "",
      "aria-pressed": String(view.alwaysAsk),
    },
    ["Always ask"],
  );
  button.addEventListener("click", () => {
    view.alwaysAsk = !view.alwaysAsk;
    button.setAttribute("aria-pressed", String(view.alwaysAsk));
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
            context.onNavigate?.({ machine: id, steps: [] });
            render();
          },
        }),
    coveragePicker(doc, {
      machine,
      mode: context.mode,
      onChange: (next) => {
        view.coverage = next;
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

/** The Controls tab: Full screen (where the browser allows), Always ask (live, a payload event), Diagram only. */
function controlsOf(doc: Document, context: Chrome): HTMLElement {
  const { root, machine, view } = context;
  const diagramOnly = html(doc, "button", { type: "button", class: "diagram-only-toggle" }, [
    "Diagram only",
  ]);
  diagramOnly.setAttribute("data-diagram-only", "");
  diagramOnly.addEventListener("click", () => context.setDiagramOnly(true));
  return html(doc, "div", { class: "controls" }, [
    fullscreenButton(doc, root),
    context.live && machine.events.some((each) => asksForPayload(machine, each.id))
      ? alwaysAskButton(doc, view)
      : null,
    diagramOnly,
  ]);
}

/** Everything drawn over the graph: walk marks, selection, and the edge of the open payload sheet. */
function markDiagram(
  root: HTMLElement,
  context: { machine: VizMachine; view: ViewState; refresh: () => void } & Pick<
    LiveContext,
    "send" | "compose"
  >,
): void {
  const { machine, view } = context;
  markExplore(root, { machine, path: view.path, ...liveState(view) });
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
