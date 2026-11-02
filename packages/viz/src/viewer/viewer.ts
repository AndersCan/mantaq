import type { VizDocument, VizDriver, VizLiveState, VizMachine, VizStep } from "../schema.ts";
import { html } from "./dom.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { availableModes, modeLabel, unreachedText } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { renderPanel } from "./panel.ts";
import { decodeLiveSteps, decodePath, encodeLiveStep, encodeStep } from "../moves.ts";
import type { ExploreStep } from "../moves.ts";
import { clickStep, explorePanel, markExplore } from "./explore.ts";

export const STRUCTURE_BANNER =
  "Click a pulsing edge, or a state it leads to, to walk the machine. Edges come from each handler's declared `to` list and effects' `sends`; guards are not evaluated, so a path here may not happen at runtime.";

const LIVE_BANNER =
  "Live: the real machine runs. Send an input and the cursor follows its actual state; guards and effects run.";

export const FUZZ_NOTE =
  "Green edges were observed while fuzzing but not declared. Fuzzing finds behaviour; it never proves an edge is impossible.";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  /** null = use the machine's best available mode. */
  coverage: CoverageMode | null;
  /** Steps taken from the initial state. */
  path: ExploreStep[];
  /** Set while a driver runs the actor. */
  live: VizLiveState | null;
}

function effectiveMode(view: ViewState, machine: VizMachine): CoverageMode {
  const modes = availableModes(machine);
  if (view.coverage === "off") return "off";
  if (view.coverage !== null && modes.includes(view.coverage)) return view.coverage;
  return modes[0] ?? "off";
}

function legend(
  doc: Document,
  { mode, machine }: { mode: CoverageMode; machine: VizMachine },
): HTMLUListElement {
  const entries: Array<[string, string]> = [
    ["legend-final", "double border: final state"],
    ["legend-undetermined", "dashed edge to ?: target undetermined"],
    ["legend-internal", "dotted edge, italic label: internal event"],
    ["legend-effect", "faint self-loop: state runs effects on entry"],
    ["legend-current", "thick accent border: where the walk is"],
    ["legend-next", "pulsing: a possible next step"],
    ["legend-taken", "bold accent: path taken"],
  ];
  if (machine.fuzz !== null) {
    entries.push(
      ["legend-fuzz", "green: observed only while fuzzing"],
      ["legend-stay", "dotted self-loop: handled, no state change"],
    );
  }
  if (mode !== "off") entries.push(["legend-unreached", unreachedText(mode, machine)]);
  return html(
    doc,
    "ul",
    { class: "legend" },
    entries.map(([name, text]) => html(doc, "li", { class: name }, [text])),
  );
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
  return value === "off" || value === "run" || value === "tests";
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
  /** Called after every walk or machine change, e.g. to keep the URL shareable. */
  onNavigate?: (where: { machine: string; steps: string[] }) => void;
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
  const view: ViewState = {
    machineId: first?.id ?? "",
    selection: null,
    coverage: null,
    path:
      first === undefined || options.driver !== undefined
        ? []
        : decodePath(first, options.steps ?? []),
    live: null,
  };
  const { driver } = options;
  if (driver !== undefined) view.live = replay(driver, decodeLiveSteps(options.steps ?? []));
  // Re-bound by each render: ArrowLeft steps back.
  let back: () => void = () => undefined;
  root.addEventListener("keydown", (event) => {
    if (!("key" in event) || event.target instanceof HTMLSelectElement) return;
    if (event.key === "ArrowLeft") back();
  });

  function render(): void {
    const machine = viz.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("viz");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const mode = effectiveMode(view, machine);
    root.classList.toggle("coverage-on", mode !== "off");
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    // Walking and selecting only swap the panel and marks; the SVG stays put so keyboard focus survives.
    const refresh = () => {
      panel.replaceChildren(
        explorePanel(doc, {
          machine,
          path: view.path,
          take,
          rewind,
          ...(view.live === null ? {} : { live: { state: view.live, send } }),
        }),
        renderPanel(doc, machine, { selection: view.selection, select }),
      );
      markExplore(root, { machine, path: view.path, ...liveState(view) });
      markSelection(root, view.selection);
    };
    const walked = () => {
      const steps =
        view.live === null
          ? view.path.map((step) => encodeStep(machine, step))
          : view.live.steps.map(encodeLiveStep);
      options.onNavigate?.({ machine: machine.id, steps });
      refresh();
    };
    const send = (step: VizStep) => {
      if (driver === undefined) return;
      view.live = stepSafely(driver, { before: view.live, step });
      walked();
    };
    const take = (step: ExploreStep) => {
      if (driver !== undefined) {
        const event = machine.edges.find((edge) => edge.id === step.edge)?.event;
        if (event !== undefined) send({ kind: "event", event, payload: null });
        return;
      }
      view.path = [...view.path, step];
      walked();
    };
    const rewind = (length: number) => {
      if (driver !== undefined && view.live !== null) {
        view.live = replay(driver, view.live.steps.slice(0, Math.max(0, length)));
        walked();
        return;
      }
      view.path = view.path.slice(0, Math.max(0, length));
      walked();
    };
    // A click on a next step takes it; either way the clicked element's details show.
    const select = (selection: Selection) => {
      const step = clickStep(machine, { path: view.path, selection, ...liveState(view) });
      view.selection = selection;
      if (step === null) refresh();
      else take(step);
    };
    back = () => rewind((view.live?.steps.length ?? view.path.length) - 1);
    root.append(
      headerOf(doc, {
        viz,
        machine,
        view,
        heading: options.heading ?? "h1",
        mode,
        render,
        onNavigate: options.onNavigate,
        live: driver !== undefined,
      }),
      html(doc, "p", { class: "banner", role: "note" }, [
        driver === undefined ? banner(machine) : LIVE_BANNER,
      ]),
      legend(doc, { mode, machine }),
      html(doc, "div", { class: "viz-main" }, [
        html(doc, "div", { class: "canvas" }, [renderGraph(doc, machine, { select, mode })]),
        panel,
      ]),
    );
    refresh();
  }

  render();
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
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function headerOf(
  doc: Document,
  context: {
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
  ]);
}

function banner(machine: VizMachine): string {
  return machine.fuzz === null ? STRUCTURE_BANNER : `${STRUCTURE_BANNER} ${FUZZ_NOTE}`;
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

function liveState(view: ViewState): { live?: string } {
  return view.live === null ? {} : { live: view.live.state };
}

/** Back is reset plus replay: the driver keeps no history. */
function replay(driver: VizDriver, steps: ReadonlyArray<VizStep>): VizLiveState {
  let live = driver.reset();
  for (const step of steps) live = driver.step(step);
  return live;
}
