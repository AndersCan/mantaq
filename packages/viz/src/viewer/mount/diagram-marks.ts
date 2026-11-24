import { drawChildMarkers, drawQueue } from "../markers.ts";
import { listOf, markExplore } from "../explore.ts";
import type { PickedChild, ViewState } from "./view-state.ts";
import type { VizDriver, VizMachine } from "../../schema.ts";
import { currentsOf } from "../compartments.ts";
import { queueOf } from "../queue.ts";
import type { Selection } from "../graph.ts";
import { updateBlocked } from "./arrow-send.ts";

export interface MarkDiagramContext {
  machine: VizMachine;
  view: ViewState;
  driver: VizDriver | undefined;
  pick: (child: PickedChild) => void;
}

/** Everything drawn over the graph: walk marks and selection. */
export function markDiagram(root: HTMLElement, context: MarkDiagramContext): void {
  const { machine, view } = context;
  updateBlocked(view, { machine, driver: context.driver });
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
  markSelection(root, { selection: view.selection });
}

interface MarkSelectionOptions {
  selection: Selection | null;
}

/** The node ids that the arrows holding the selected edge leave from. */
function arrowSources(root: HTMLElement, options: MarkSelectionOptions): Set<string | undefined> {
  const { selection } = options;
  const sources = new Set<string | undefined>();
  if (selection?.kind !== "edge") return sources;
  for (const arrow of root.querySelectorAll<SVGGElement>(".graph g[data-members]")) {
    if (listOf(arrow.dataset["members"])?.includes(selection.id)) {
      sources.add(arrow.dataset["from"]);
    }
  }
  return sources;
}

function markSelection(root: HTMLElement, options: MarkSelectionOptions): void {
  const { selection } = options;
  const attribute = selection?.kind === "edge" ? "edgeId" : "nodeId";
  const arrowNodes = arrowSources(root, options);
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
