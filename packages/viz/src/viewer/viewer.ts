import type {
  VizDocument,
  VizActorRef,
  VizLiveChild,
  VizDriver,
  VizJson,
  VizLiveState,
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
import { clickStep, explorePanel, markExplore, changedLines } from "./explore.ts";
import type { ExploreContext, ExploreParts } from "./explore.ts";
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
  /** Context before the last live step; undefined when no step ran. */
  previous: VizJson | undefined;
  /** Live: the event whose payload form is open. */
  composing: string | null;
  /** Live: the region the open payload form sends to; undefined = the machine itself. */
  composingActor: VizActorRef | undefined;
  /** The panel tab shown. */
  tab: PanelTab;
  /** Why the requested run did not open; cleared by the next walk. */
  notice: string | null;
}

type PanelTab = "step" | "context" | "path" | "details";

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
  listenOnRoot(root, () => back());
  let redraw: () => void = () => undefined;
  const changing = { option: options.changes, seen: false, render: () => render() };
  watchDriver(view, { driver, redraw: () => redraw() });

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
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
    const refresh = () => {
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
      fillPanel(panel, { doc, view, parts, details, refresh, footer: options.panelFooter });
      markDiagram(root, { machine, view, send, compose });
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
      if (driver !== undefined) {
        liveTake(machine, step, { send, compose, children: view.live?.children ?? [] });
        return;
      }
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
      if (shown?.findings === true) panel.querySelector<HTMLElement>(".state-findings h4")?.focus();
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
    root.append(
      ...noticeOf(doc, view),
      headerOf(doc, {
        root,
        viz,
        machine,
        view,
        heading: options.heading ?? "h1",
        mode,
        render,
        onNavigate: options.onNavigate,
        live: driver !== undefined,
      }),
      ...changes,
      html(doc, "div", { class: "viz-main" }, [
        html(doc, "div", { class: "canvas" }, [graph]),
        panel,
      ]),
    );
    refresh();
  }

  render();
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
    previous: undefined,
    composing: null,
    composingActor: undefined,
    tab: "step",
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

/** Step, Context (live only), Path and Details as tabs; Context counts the lines the last step changed. */
function panelTabs(
  doc: Document,
  context: { view: ViewState; parts: ExploreParts; details: HTMLElement; refresh: () => void },
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

function liveOf(
  view: ViewState,
  handlers: Pick<LiveContext, "send" | "play" | "compose" | "routes">,
): { live?: LiveContext } {
  if (view.live === null) return {};
  return {
    live: { state: view.live, previous: view.previous, ...handlers },
  };
}

/** A live click on an edge: an event that carries a payload opens its form, as in the Send list. */
function liveTake(
  machine: VizMachine,
  step: ExploreStep,
  handlers: Pick<LiveContext, "send" | "compose"> & { children: ReadonlyArray<VizLiveChild> },
): void {
  const edge = machine.edges.find((each) => each.id === step.edge);
  if (edge === undefined) return;
  const { event } = edge;
  const region = scopeOf(edge.from);
  // A map edge sends only when exactly one child is in its source state.
  const inSource = handlers.children.filter((child) => child.state === edge.from);
  const [only] = inSource;
  if (machine.maps.includes(region) && (inSource.length !== 1 || only === undefined)) return;
  const actor: VizActorRef | undefined =
    only !== undefined && machine.maps.includes(region)
      ? { map: only.map, key: only.key }
      : region === ""
        ? undefined
        : { region };
  if (asksForPayload(machine, event)) handlers.compose(event, actor);
  else handlers.send({ kind: "event", event, payload: null, ...(actor ? { actor } : {}) });
}

/** An effect result that arrives later replaces the live state. */
function watchDriver(
  view: ViewState,
  context: { driver: VizDriver | undefined; redraw: () => void },
): void {
  context.driver?.listen?.((state) => {
    view.live = state;
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
  view.live = stepSafely(driver, { before: view.live, step });
  view.composing = null;
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
/** Sets `view.live` to the state after `steps` and `view.previous` to the context before the last of them. */
function replayInto(view: ViewState, driver: VizDriver, steps: ReadonlyArray<VizStep>): void {
  view.previous = steps.length === 0 ? undefined : replay(driver, steps.slice(0, -1)).context;
  view.live = replay(driver, steps);
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

/** Listeners that outlive each render: ArrowLeft steps back, and the button label follows fullscreen. */
function listenOnRoot(root: HTMLElement, back: () => void): void {
  root.addEventListener("keydown", (event) => {
    if (!("key" in event) || isTextControl(event.target)) return;
    if (event.key === "ArrowLeft") back();
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

function headerOf(
  doc: Document,
  context: {
    root: HTMLElement;
    viz: VizDocument;
    machine: VizMachine;
    view: ViewState;
    heading: "h1" | "h2" | "h3";
    mode: CoverageMode;
    render: () => void;
    onNavigate: ViewerOptions["onNavigate"];
    live: boolean;
  },
): HTMLElement {
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
    fullscreenButton(doc, context.root),
  ]);
}

/** Everything drawn over the graph: walk marks, selection, and the edge of the open payload sheet. */
function markDiagram(
  root: HTMLElement,
  context: { machine: VizMachine; view: ViewState } & Pick<LiveContext, "send" | "compose">,
): void {
  const { machine, view } = context;
  markExplore(root, { machine, path: view.path, ...liveState(view) });
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
  return view.live === null ? {} : { currents: currentsOf(view.live) };
}

/** Back is reset plus replay: the driver keeps no history. Stops at the first step the driver throws on. */
function replay(driver: VizDriver, steps: ReadonlyArray<VizStep>): VizLiveState {
  let live = driver.reset();
  for (const step of steps) {
    live = stepSafely(driver, { before: live, step });
    if (live.last?.error) return live;
  }
  return live;
}
