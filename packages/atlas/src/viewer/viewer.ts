import type { AtlasDocument, AtlasMachine } from "../schema.ts";
import { html } from "./dom.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { availableModes, modeLabel, unreachedText } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { renderPanel } from "./panel.ts";
import { clickTarget, findJourney, journeyList, journeyPanel, markJourney } from "./journey.ts";
import type { JourneyView } from "./journey.ts";

export const STRUCTURE_BANNER =
  "Edges come from each handler's declared `to` list. Guards are not evaluated, so some edges may never be taken.";

export const JOURNEY_BANNER =
  "Journey: a recorded run from a fresh actor. Every step is what the real handlers did with these inputs; only the path can be clicked.";

export const FUZZ_NOTE =
  "Green edges were observed while fuzzing but not declared. Fuzzing finds behaviour; it never proves an edge is impossible.";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  /** null = use the machine's best available mode. */
  coverage: CoverageMode | null;
  /** Journey being walked, by id; null = free exploration. */
  journey: { id: string; at: number } | null;
}

function effectiveMode(view: ViewState, machine: AtlasMachine): CoverageMode {
  const modes = availableModes(machine);
  if (view.coverage === "off") return "off";
  if (view.coverage !== null && modes.includes(view.coverage)) return view.coverage;
  return modes[0] ?? "off";
}

function legend(
  doc: Document,
  { mode, machine, journey }: { mode: CoverageMode; machine: AtlasMachine; journey: boolean },
): HTMLUListElement {
  const entries: Array<[string, string]> = [
    ["legend-final", "double border: final state"],
    ["legend-undetermined", "dashed edge to ?: target undetermined"],
    ["legend-internal", "dotted edge, italic label: internal event"],
    ["legend-effect", "faint self-loop: state runs effects on entry"],
  ];
  if (machine.fuzz !== null) {
    entries.push(
      ["legend-fuzz", "green: observed only while fuzzing"],
      ["legend-stay", "dotted self-loop: handled, no state change"],
    );
  }
  if (mode !== "off") entries.push(["legend-unreached", unreachedText(mode, machine)]);
  if (journey) {
    entries.push(
      ["legend-taken", "bold accent: already taken"],
      ["legend-next", "pulsing: click to take the next step"],
    );
  }
  return html(
    doc,
    "ul",
    { class: "legend" },
    entries.map(([name, text]) => html(doc, "li", { class: name }, [text])),
  );
}

function machineSelect(
  doc: Document,
  atlas: AtlasDocument,
  context: { view: ViewState; onChange: (id: string) => void },
): HTMLLabelElement | null {
  if (atlas.machines.length < 2) return null;
  const select = html(
    doc,
    "select",
    { class: "machine-select" },
    atlas.machines.map((machine) =>
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

function journeyPicker(
  doc: Document,
  context: { machine: AtlasMachine; current: string | null; onChange: (id: string | null) => void },
): HTMLLabelElement | null {
  if (context.machine.journeys.length === 0) return null;
  const select = html(doc, "select", { class: "journey-select" }, [
    html(doc, "option", { value: "", selected: context.current === null ? "" : null }, [
      "explore freely",
    ]),
    ...context.machine.journeys.map((journey) =>
      html(
        doc,
        "option",
        { value: journey.id, selected: journey.id === context.current ? "" : null },
        [journey.title],
      ),
    ),
  ]);
  select.addEventListener("change", () => context.onChange(select.value || null));
  return html(doc, "label", {}, ["Journey ", select]);
}

function isMode(value: string): value is CoverageMode {
  return value === "off" || value === "run" || value === "tests";
}

function coveragePicker(
  doc: Document,
  context: { machine: AtlasMachine; mode: CoverageMode; onChange: (mode: CoverageMode) => void },
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
  /** Journey to open on load (in the shown machine), e.g. from `?journey=`. */
  journey?: string;
}

/**
 * Mount a read-only viewer for an atlas document into `root`. No live actors,
 * no editing: the document is the only input.
 */
export function mountViewer(
  root: HTMLElement,
  atlas: AtlasDocument,
  options: ViewerOptions = {},
): void {
  const doc = root.ownerDocument;
  const first =
    atlas.machines.find((machine) => machine.id === options.machine) ?? atlas.machines[0];
  const view: ViewState = {
    machineId: first?.id ?? "",
    selection: null,
    coverage: null,
    journey:
      first !== undefined && options.journey !== undefined && findJourney(first, options.journey)
        ? { id: options.journey, at: 0 }
        : null,
  };
  // Re-bound by each render: arrow keys step the journey being walked.
  let step: (delta: number) => void = () => undefined;
  root.addEventListener("keydown", (event) => {
    if (!("key" in event) || event.target instanceof HTMLSelectElement) return;
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
  });

  function render(): void {
    const machine = atlas.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("atlas");
    root.classList.remove("journey-on");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const mode = effectiveMode(view, machine);
    const journey = view.journey === null ? undefined : findJourney(machine, view.journey.id);
    root.classList.toggle("coverage-on", mode !== "off" && journey === undefined);
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    const startJourney = (id: string | null) => {
      view.journey = id === null ? null : { id, at: 0 };
      view.selection = null;
      render();
    };
    const go = (at: number) => {
      if (journey === undefined || view.journey === null) return;
      view.journey.at = Math.max(0, Math.min(at, journey.moves.length));
      showJourney({ journey, at: view.journey.at });
    };
    // Steps only swap the panel and marks; the SVG stays put so keyboard focus survives.
    const showJourney = (walk: JourneyView) => {
      panel.replaceChildren(
        journeyPanel(doc, { machine, view: walk, go, exit: () => startJourney(null) }),
      );
      markJourney(root, { machine, view: walk });
    };
    const idle = () =>
      html(doc, "div", {}, [
        journeyList(doc, { machine, start: startJourney }),
        renderPanel(doc, machine, { selection: null, select }),
      ]);
    // Selection only swaps the panel and marks; the SVG stays put so keyboard focus survives.
    const select = (selection: Selection) => {
      if (journey !== undefined && view.journey !== null) {
        const at = clickTarget({ journey, at: view.journey.at }, { machine, selection });
        if (at !== null) go(at);
        return;
      }
      view.selection = selection;
      panel.replaceChildren(renderPanel(doc, machine, { selection, select }));
      markSelection(root, selection);
    };
    step = (delta) => {
      if (view.journey !== null) go(view.journey.at + delta);
    };
    const header = headerOf(doc, {
      atlas,
      machine,
      view,
      heading: options.heading ?? "h1",
      mode,
      walking: journey !== undefined,
      startJourney,
      render,
    });
    root.append(
      header,
      html(doc, "p", { class: "banner", role: "note" }, [banner(machine, journey !== undefined)]),
      legend(doc, {
        mode: journey === undefined ? mode : "off",
        machine,
        journey: journey !== undefined,
      }),
      html(doc, "div", { class: "atlas-main" }, [
        html(doc, "div", { class: "canvas" }, [renderGraph(doc, machine, { select, mode })]),
        panel,
      ]),
    );
    if (journey !== undefined && view.journey !== null) {
      showJourney({ journey, at: view.journey.at });
      return;
    }
    panel.append(
      view.selection === null
        ? idle()
        : renderPanel(doc, machine, { selection: view.selection, select }),
    );
    markSelection(root, view.selection);
  }

  render();
}

function headerOf(
  doc: Document,
  context: {
    atlas: AtlasDocument;
    machine: AtlasMachine;
    view: ViewState;
    heading: "h1" | "h2" | "h3";
    mode: CoverageMode;
    walking: boolean;
    startJourney: (id: string | null) => void;
    render: () => void;
  },
): HTMLElement {
  const { machine, view, render } = context;
  return html(doc, "header", { class: "atlas-header" }, [
    html(doc, context.heading, {}, [`Atlas: ${machine.id}`]),
    machineSelect(doc, context.atlas, {
      view,
      onChange: (id) => {
        view.machineId = id;
        view.selection = null;
        view.journey = null;
        render();
      },
    }),
    journeyPicker(doc, {
      machine,
      current: context.walking ? (view.journey?.id ?? null) : null,
      onChange: context.startJourney,
    }),
    context.walking
      ? null
      : coveragePicker(doc, {
          machine,
          mode: context.mode,
          onChange: (next) => {
            view.coverage = next;
            render();
          },
        }),
  ]);
}

function banner(machine: AtlasMachine, walking: boolean): string {
  if (walking) return JOURNEY_BANNER;
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
