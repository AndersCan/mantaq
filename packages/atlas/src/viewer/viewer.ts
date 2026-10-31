import type { AtlasDocument, AtlasMachine } from "../schema.ts";
import { html } from "./dom.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { availableModes, modeLabel, unreachedText } from "./coverage-mode.ts";
import type { CoverageMode } from "./coverage-mode.ts";
import { renderPanel } from "./panel.ts";

export const STRUCTURE_BANNER =
  "Edges come from each handler's declared `to` list. Guards are not evaluated, so some edges may never be taken.";

export const FUZZ_NOTE =
  "Green edges were observed while fuzzing but not declared. Fuzzing finds behaviour; it never proves an edge is impossible.";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  /** null = use the machine's best available mode. */
  coverage: CoverageMode | null;
}

function effectiveMode(view: ViewState, machine: AtlasMachine): CoverageMode {
  const modes = availableModes(machine);
  if (view.coverage === "off") return "off";
  if (view.coverage !== null && modes.includes(view.coverage)) return view.coverage;
  return modes[0] ?? "off";
}

function legend(
  doc: Document,
  { mode, machine }: { mode: CoverageMode; machine: AtlasMachine },
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

/**
 * Mount a read-only viewer for an atlas document into `root`. No live actors,
 * no editing: the document is the only input.
 */
export function mountViewer(root: HTMLElement, atlas: AtlasDocument): void {
  const doc = root.ownerDocument;
  const view: ViewState = {
    machineId: atlas.machines[0]?.id ?? "",
    selection: null,
    coverage: null,
  };

  function render(): void {
    const machine = atlas.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("atlas");
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const mode = effectiveMode(view, machine);
    root.classList.toggle("coverage-on", mode !== "off");
    const panel = html(doc, "aside", { class: "panel", "aria-live": "polite" });
    // Selection only swaps the panel and marks; the SVG stays put so keyboard focus survives.
    const select = (selection: Selection) => {
      view.selection = selection;
      panel.replaceChildren(renderPanel(doc, machine, { selection, select }));
      markSelection(root, selection);
    };
    const header = html(doc, "header", { class: "atlas-header" }, [
      html(doc, "h1", {}, [`Atlas: ${machine.id}`]),
      machineSelect(doc, atlas, {
        view,
        onChange: (id) => {
          view.machineId = id;
          view.selection = null;
          render();
        },
      }),
      coveragePicker(doc, {
        machine,
        mode,
        onChange: (next) => {
          view.coverage = next;
          render();
        },
      }),
    ]);
    root.append(
      header,
      html(doc, "p", { class: "banner", role: "note" }, [
        machine.fuzz === null ? STRUCTURE_BANNER : `${STRUCTURE_BANNER} ${FUZZ_NOTE}`,
      ]),
      legend(doc, { mode, machine }),
      html(doc, "div", { class: "atlas-main" }, [
        html(doc, "div", { class: "canvas" }, [renderGraph(doc, machine, { select, mode })]),
        panel,
      ]),
    );
    panel.append(renderPanel(doc, machine, { selection: view.selection, select }));
    markSelection(root, view.selection);
  }

  render();
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
