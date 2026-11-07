import { arrowKey, isUnchanged, outlineChanges, outlineOf } from "../outline.ts";
import type { MachineChanges, MachineOutline, OutlineArrow } from "../outline.ts";
import { isAnyState } from "../schema.ts";
import type { VizMachine } from "../schema.ts";
import { html } from "./dom.ts";

/** What a viewer is told to mark: see `ViewerOptions.changes`. */
export interface ChangesOption {
  machine: string;
  before: MachineOutline;
  onSeen: () => void;
}

const MAX_ITEMS = 12;

/** The changes to show for `machine`, or null when there is nothing to mark. */
function changesFor(machine: VizMachine, option: ChangesOption | undefined): MachineChanges | null {
  if (option === undefined || option.machine !== machine.id) return null;
  const changes = outlineChanges(option.before, outlineOf(machine));
  return isUnchanged(changes) ? null : changes;
}

function sourceText(from: string): string {
  return isAnyState(from) ? "any state" : from;
}

function arrowText(verb: string, arrow: OutlineArrow): string {
  const source = sourceText(arrow.from);
  if (arrow.kind === "stay") return `${verb} arrow ${arrow.event} in ${source}, stays`;
  return `${verb} arrow ${arrow.event} from ${source} to ${arrow.to ?? "an undetermined state"}`;
}

function changeItems(changes: MachineChanges): string[] {
  return [
    ...changes.addedStates.map((id) => `Added state ${id}`),
    ...changes.addedArrows.map((arrow) => arrowText("Added", arrow)),
    ...changes.removedStates.map((id) => `Removed state ${id}`),
    ...changes.removedArrows.map((arrow) => arrowText("Removed", arrow)),
  ];
}

function mark(group: Element): void {
  group.classList.add("added");
  const label = group.getAttribute("aria-label");
  if (label !== null) group.setAttribute("aria-label", `${label}, new`);
}

/** Outline added states and arrows in the drawn graph. Ids are compared, never put in a selector. */
function markChanges(root: ParentNode, machine: VizMachine, changes: MachineChanges): void {
  const states = new Set(changes.addedStates);
  const keys = new Set(changes.addedArrows.map(arrowKey));
  const addedEdges = new Set(
    machine.edges
      .filter(
        (edge) =>
          (edge.kind === "transition" || edge.kind === "stay") &&
          keys.has(arrowKey({ from: edge.from, event: edge.event, to: edge.to, kind: edge.kind })),
      )
      .map((edge) => edge.id),
  );
  for (const group of root.querySelectorAll("g.state[data-node-id]")) {
    if (states.has(group.getAttribute("data-node-id") ?? "")) mark(group);
  }
  for (const group of root.querySelectorAll("g.edge[data-edge-id]")) {
    if (addedEdges.has(group.getAttribute("data-edge-id") ?? "")) mark(group);
  }
}

/** Marks the graph and returns the list to show above it (none when nothing changed). */
export function changesSection(
  doc: Document,
  machine: VizMachine,
  graph: ParentNode,
  /** `seen` remembers that the reader pressed Mark as seen, for this mount. */
  state: { option: ChangesOption | undefined; seen: boolean; render: () => void },
): HTMLElement[] {
  const { option, render } = state;
  const changes = state.seen ? null : changesFor(machine, option);
  if (changes === null) return [];
  markChanges(graph, machine, changes);
  return [
    changesList(doc, changes, () => {
      option?.onSeen();
      state.seen = true;
      render();
    }),
  ];
}

/** The "What changed" list with its Mark as seen button. */
function changesList(doc: Document, changes: MachineChanges, onSeen: () => void): HTMLElement {
  const items = changeItems(changes);
  const shown = items.slice(0, MAX_ITEMS);
  if (items.length > MAX_ITEMS) shown.push(`and ${items.length - MAX_ITEMS} more`);
  const button = html(doc, "button", { type: "button" }, ["Mark as seen"]);
  button.addEventListener("click", onSeen);
  return html(doc, "section", { class: "changes", "aria-label": "What changed" }, [
    html(doc, "strong", {}, ["What changed"]),
    html(
      doc,
      "ul",
      {},
      shown.map((text) => html(doc, "li", {}, [text])),
    ),
    button,
  ]);
}
