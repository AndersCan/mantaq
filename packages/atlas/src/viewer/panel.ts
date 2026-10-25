import type { AtlasEdge, AtlasMachine, AtlasState, AtlasStep } from "../schema.ts";
import { activatable, html } from "./dom.ts";
import { renderExplanation } from "./explanation.ts";
import type { Selection } from "./graph.ts";

type Row = [label: string, value: Node | string];

function list(doc: Document, rows: ReadonlyArray<Row>): HTMLDListElement {
  return html(
    doc,
    "dl",
    {},
    rows.flatMap(([label, value]) => [
      html(doc, "dt", {}, [label]),
      html(doc, "dd", { "data-field": label }, [value]),
    ]),
  );
}

function joined(values: ReadonlyArray<string>): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function hitsText(coverage: { hits: number } | null): string {
  return coverage === null ? "not supplied" : String(coverage.hits);
}

function runLabel(machine: AtlasMachine): string {
  return machine.fuzz === null ? "run hits" : "fuzz hits";
}

/**
 * A probe edge no fuzz run produced. Probing calls the handler with `{}` and a
 * sample context, so it can predict a target the live machine never reaches.
 */
function predictionNote(doc: Document, edge: AtlasEdge, machine: AtlasMachine): HTMLElement | null {
  const unobserved = edge.coverage !== null && edge.coverage.hits === 0;
  if (
    machine.fuzz === null ||
    edge.origin !== "probe" ||
    edge.kind !== "transition" ||
    !unobserved
  ) {
    return null;
  }
  return html(doc, "p", { class: "prediction-note", role: "note" }, [
    "Probing predicted this edge, but no fuzz run produced it. Probing calls the handler with an empty payload and a sample context, so this edge may be impossible in a real run. Fuzzing never proves that, so check the handler.",
  ]);
}

function stepText(step: AtlasStep): string {
  if (step.kind === "advance") return `advance ${step.ms}ms`;
  return step.payload === null ? step.event : `${step.event} ${JSON.stringify(step.payload)}`;
}

function featureOf(edge: AtlasEdge): string | null {
  if (edge.kind === "stay") return `stay:${edge.from}>${edge.event}`;
  if (edge.kind !== "transition" || edge.to === null) return null;
  return `edge:${edge.from}>${edge.event}>${edge.to}`;
}

/** Shortest kept fuzz sequence that first reached this edge, as a numbered list. */
function reachedBy(doc: Document, edge: AtlasEdge, machine: AtlasMachine): Node | string {
  const feature = featureOf(edge);
  if (machine.fuzz === null) return "not fuzzed";
  const sequences = machine.fuzz.corpus.filter(
    (sequence) => feature !== null && sequence.discovered.includes(feature),
  );
  const shortest = sequences.sort((left, right) => left.steps.length - right.steps.length)[0];
  if (shortest === undefined) return "no kept sequence";
  if (shortest.steps.length === 0) return "initial state";
  return html(
    doc,
    "ol",
    { class: "steps" },
    shortest.steps.map((step) => html(doc, "li", {}, [stepText(step)])),
  );
}

function targetText(edge: AtlasEdge): string {
  if (edge.kind === "stay") return `${edge.to ?? edge.from} (handled, no state change)`;
  return edge.to ?? "undetermined";
}

function edgeLink(
  doc: Document,
  edge: AtlasEdge,
  select: (selection: Selection) => void,
): HTMLLIElement {
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${edge.from} —${edge.event || "initial"}→ ${edge.to ?? "?"}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

function edgeList(
  doc: Document,
  edges: ReadonlyArray<AtlasEdge>,
  select: (selection: Selection) => void,
): Node | string {
  if (edges.length === 0) return "none";
  return html(
    doc,
    "ul",
    {},
    edges.map((edge) => edgeLink(doc, edge, select)),
  );
}

function edgePanel(doc: Document, edge: AtlasEdge, machine: AtlasMachine): HTMLElement {
  const internal = machine.events.find((event) => event.id === edge.event)?.internal === true;
  return html(doc, "section", { class: "details", "data-selected-edge": edge.id }, [
    html(doc, "h2", {}, [`Edge ${edge.id}`]),
    predictionNote(doc, edge, machine),
    list(doc, [
      ["source", edge.from],
      [
        "event",
        edge.kind === "initial" ? "(initial)" : `${edge.event}${internal ? " (internal)" : ""}`,
      ],
      ["target", targetText(edge)],
      ["kind", edge.kind],
      ["origin", edge.origin === "fuzz" ? "fuzz (observed, not probed)" : "probe"],
      ["emits", joined(edge.emits)],
      ["contexts", joined(edge.contexts)],
      [runLabel(machine), hitsText(edge.coverage)],
      ["test hits", hitsText(edge.tested)],
      ["explanation", renderExplanation(doc, { edge, machine })],
      ["reached by", reachedBy(doc, edge, machine)],
    ]),
  ]);
}

function statePanel(
  doc: Document,
  state: AtlasState,
  context: { machine: AtlasMachine; select: (selection: Selection) => void },
): HTMLElement {
  const { machine, select } = context;
  const flags = [state.initial ? "initial" : "", state.final ? "final" : ""].filter(Boolean);
  const outgoing = machine.edges.filter((edge) => edge.from === state.id);
  const incoming = machine.edges.filter((edge) => edge.to === state.id && edge.kind !== "initial");
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${state.id}`]),
    list(doc, [
      ["id", state.id],
      ["region", state.region ?? "(root)"],
      ["flags", joined(flags)],
      [machine.fuzz === null ? "run visits" : "fuzz visits", hitsText(state.coverage)],
      ["test visits", hitsText(state.tested)],
      ["outgoing", edgeList(doc, outgoing, select)],
      ["incoming", edgeList(doc, incoming, select)],
    ]),
  ]);
}

function fuzzSummary(doc: Document, machine: AtlasMachine): HTMLElement | null {
  const { fuzz } = machine;
  if (fuzz === null) return null;
  const errors: Node | string =
    fuzz.errors.length === 0
      ? "none"
      : html(
          doc,
          "ul",
          {},
          fuzz.errors.map((error) =>
            html(doc, "li", { class: "fuzz-error" }, [
              `${error.from} on ${error.event}: ${error.message} — `,
              html(doc, "code", {}, [error.steps.map(stepText).join(" → ")]),
            ]),
          ),
        );
  return html(doc, "section", { class: "fuzz-summary" }, [
    html(doc, "h2", {}, ["Fuzz run"]),
    list(doc, [
      ["seed", String(fuzz.seed)],
      ["iterations", String(fuzz.iterations)],
      ["kept sequences", String(fuzz.corpus.length)],
      ["handler errors", errors],
    ]),
  ]);
}

/** Side-panel body for the current selection, or a hint when nothing is selected. */
export function renderPanel(
  doc: Document,
  machine: AtlasMachine,
  context: { selection: Selection | null; select: (selection: Selection) => void },
): HTMLElement {
  const { selection } = context;
  if (selection?.kind === "edge") {
    const edge = machine.edges.find((candidate) => candidate.id === selection.id);
    if (edge) return edgePanel(doc, edge, machine);
  }
  if (selection?.kind === "state") {
    const state = machine.states.find((candidate) => candidate.id === selection.id);
    if (state) return statePanel(doc, state, { machine, select: context.select });
  }
  return html(doc, "div", {}, [
    html(doc, "p", { class: "hint" }, ["Select a state or edge."]),
    fuzzSummary(doc, machine),
  ]);
}
