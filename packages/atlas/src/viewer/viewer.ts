import type { AtlasDocument, AtlasMachine } from "../schema.ts";
import { html } from "./dom.ts";
import { renderGraph } from "./graph.ts";
import type { Selection } from "./graph.ts";
import { renderPanel } from "./panel.ts";

export const PROBE_BANNER =
  "Edges come from synthetic probing; payload-dependent branches may be missing.";

interface ViewState {
  machineId: string;
  selection: Selection | null;
  coverage: boolean;
}

function hasCoverage(machine: AtlasMachine): boolean {
  return (
    machine.states.some((state) => state.coverage !== null) ||
    machine.edges.some((edge) => edge.coverage !== null)
  );
}

function legend(doc: Document, showCoverage: boolean): HTMLUListElement {
  const entries: Array<[string, string]> = [
    ["legend-final", "double border: final state"],
    ["legend-undetermined", "dashed edge to ?: target undetermined"],
    ["legend-internal", "dotted edge, italic label: internal event"],
    ["legend-effect", "faint self-loop: state runs effects on entry"],
  ];
  if (showCoverage) entries.push(["legend-unreached", "dimmed and dashed: never reached in run"]);
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

function coverageToggle(
  doc: Document,
  context: { view: ViewState; onChange: (on: boolean) => void },
): HTMLLabelElement {
  const input = html(doc, "input", {
    type: "checkbox",
    class: "coverage-toggle",
    checked: context.view.coverage ? "" : null,
  });
  input.addEventListener("change", () => context.onChange(input.checked));
  return html(doc, "label", {}, [input, " Show coverage"]);
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
    coverage: true,
  };

  function render(): void {
    const machine = atlas.machines.find((candidate) => candidate.id === view.machineId);
    root.replaceChildren();
    root.classList.add("atlas");
    root.classList.toggle("coverage-on", view.coverage);
    if (!machine) {
      root.append(html(doc, "p", { class: "empty" }, ["Document has no machines."]));
      return;
    }
    const covered = hasCoverage(machine);
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
      covered
        ? coverageToggle(doc, {
            view,
            onChange: (on) => {
              view.coverage = on;
              render();
            },
          })
        : null,
    ]);
    root.append(
      header,
      html(doc, "p", { class: "banner", role: "note" }, [PROBE_BANNER]),
      legend(doc, covered),
      html(doc, "div", { class: "atlas-main" }, [
        html(doc, "div", { class: "canvas" }, [renderGraph(doc, machine, { select })]),
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
