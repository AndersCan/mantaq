import { routingWarnings } from "../routing.ts";
import { coveredByAny, isAnyState } from "../schema.ts";
import type { VizEdge, VizMachine, VizState, VizStep } from "../schema.ts";
import { machineFindings } from "../findings.ts";
import type { VizFinding } from "../findings.ts";
import { activatable, html } from "./dom.ts";
import { renderExplanation } from "./explanation.ts";
import type { Selection } from "./graph.ts";
import { rulesSection } from "./rules.ts";

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

const ORIGIN_LABELS: Record<VizEdge["origin"], string> = {
  declared: "declared (builder `to`)",
  probe: "probe",
  fuzz: "fuzz (observed, not declared)",
};

function runLabel(machine: VizMachine): string {
  return machine.fuzz === null ? "run hits" : "fuzz hits";
}

/**
 * A declared or probed edge no fuzz run produced. `to` lists what the handler
 * may return, not what its guards allow; probing runs it with `{}` and a sample
 * context. Either way the live machine may never take it.
 */
function predictionNote(doc: Document, edge: VizEdge, machine: VizMachine): HTMLElement | null {
  const unobserved = edge.coverage !== null && edge.coverage.hits === 0;
  if (
    machine.fuzz === null ||
    edge.origin === "fuzz" ||
    edge.kind !== "transition" ||
    !unobserved
  ) {
    return null;
  }
  const source =
    edge.origin === "declared"
      ? "The handler declares this target in `to`, but no fuzz run produced it. Its guards may never allow it."
      : "Probing predicted this edge, but no fuzz run produced it. Probing calls the handler with an empty payload and a sample context, so this edge may be impossible in a real run.";
  return html(doc, "p", { class: "prediction-note", role: "note" }, [
    `${source} Fuzzing never proves that, so check the handler.`,
  ]);
}

function stepText(step: VizStep): string {
  if (step.kind === "advance") return `advance ${step.ms}ms`;
  return step.payload === null ? step.event : `${step.event} ${JSON.stringify(step.payload)}`;
}

function featureOf(edge: VizEdge): string | null {
  if (edge.kind === "stay") return `stay:${edge.from}>${edge.event}`;
  if (edge.kind !== "transition" || edge.to === null) return null;
  return `edge:${edge.from}>${edge.event}>${edge.to}`;
}

/** Shortest kept fuzz sequence that first reached this edge, as a numbered list. */
function reachedBy(doc: Document, edge: VizEdge, machine: VizMachine): Node | string {
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

function targetText(edge: VizEdge): string {
  if (edge.kind === "stay") return `${edge.to ?? edge.from} (handled, no state change)`;
  return edge.to ?? "undetermined";
}

function sourceText(from: string): string {
  return isAnyState(from) ? "any state" : from;
}

function routingNote(doc: Document, edge: VizEdge, machine: VizMachine): HTMLElement | null {
  if (!isAnyState(edge.from)) return null;
  const warning = routingWarnings(machine).find((each) => each.event === edge.event);
  return warning
    ? html(doc, "p", { class: "routing-note", role: "note" }, [warning.message])
    : null;
}

function edgeLink(
  doc: Document,
  edge: VizEdge,
  select: (selection: Selection) => void,
): HTMLLIElement {
  const link = html(doc, "span", { class: "link", "data-edge-link": edge.id }, [
    `${sourceText(edge.from)} —${edge.event || "initial"}→ ${edge.to ?? "?"}`,
  ]);
  activatable(link, () => select({ kind: "edge", id: edge.id }));
  return html(doc, "li", {}, [link]);
}

function edgeList(
  doc: Document,
  edges: ReadonlyArray<VizEdge>,
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

function edgePanel(
  doc: Document,
  edge: VizEdge,
  context: { machine: VizMachine; replay: Replay },
): HTMLElement {
  const { machine, replay } = context;
  const internal = machine.events.find((event) => event.id === edge.event)?.internal === true;
  return html(doc, "section", { class: "details", "data-selected-edge": edge.id }, [
    html(doc, "h2", {}, [`Edge ${edge.id}`]),
    machineWide(doc, machine, replay),
    routingNote(doc, edge, machine),
    predictionNote(doc, edge, machine),
    list(doc, [
      ["source", isAnyState(edge.from) ? "any state (onAny)" : edge.from],
      [
        "event",
        edge.kind === "initial" ? "(initial)" : `${edge.event}${internal ? " (internal)" : ""}`,
      ],
      ["target", targetText(edge)],
      ["doc", edge.doc ?? "none"],
      ["kind", edge.kind],
      ["origin", ORIGIN_LABELS[edge.origin]],
      ["emits", joined(edge.emits)],
      ["contexts", joined(edge.contexts)],
      [runLabel(machine), hitsText(edge.coverage)],
      ["test hits", hitsText(edge.tested)],
      ["explanation", renderExplanation(doc, { edge, machine })],
      ["reached by", reachedBy(doc, edge, machine)],
    ]),
  ]);
}

const REPLAY_LABELS: Partial<Record<VizFinding["kind"], string>> = {
  deadEnd: "Replay how it gets stuck",
  handlerError: "Replay the throw",
};

type Replay = ((steps: ReadonlyArray<VizStep>) => void) | undefined;

function findingArticle(doc: Document, finding: VizFinding, replay: Replay): HTMLElement {
  const { steps } = finding;
  const path =
    steps === null || steps.length === 0
      ? [html(doc, "p", { class: "finding-no-replay" }, [finding.noReplay ?? ""])]
      : [
          html(doc, "p", {}, ["Found by:"]),
          html(
            doc,
            "ol",
            { class: "steps" },
            steps.map((step) => html(doc, "li", {}, [stepText(step)])),
          ),
        ];
  const button =
    replay === undefined || steps === null || steps.length === 0
      ? null
      : html(doc, "button", { type: "button", "data-replay": "" }, [
          REPLAY_LABELS[finding.kind] ?? "Replay how it gets here",
        ]);
  button?.addEventListener("click", () => replay?.(steps ?? []));
  return html(
    doc,
    "article",
    {
      class: "finding",
      "data-kind": finding.kind,
      "data-state": finding.state ?? "",
      "data-event": finding.event ?? "",
      ...(finding.note ? { "data-note": "" } : {}),
    },
    [
      html(doc, "h4", { tabindex: "-1" }, [finding.title]),
      html(doc, "p", {}, [finding.proof]),
      html(doc, "p", { class: "finding-fix" }, [`Fix: ${finding.fix}`]),
      ...path,
      button,
    ],
  );
}

function findingsSection(
  doc: Document,
  findings: ReadonlyArray<VizFinding>,
  context: { className: string; heading: string; count: string; replay: Replay },
): HTMLElement | null {
  if (findings.length === 0) return null;
  return html(
    doc,
    "section",
    { class: context.className, [context.count]: String(findings.length) },
    [
      html(doc, "h3", {}, [context.heading]),
      ...findings.map((finding) => findingArticle(doc, finding, context.replay)),
    ],
  );
}

function bugs(findings: ReadonlyArray<VizFinding>): VizFinding[] {
  return findings.filter((finding) => !finding.note);
}

function notes(findings: ReadonlyArray<VizFinding>): VizFinding[] {
  return findings.filter((finding) => finding.note);
}

function notesSection(
  doc: Document,
  findings: ReadonlyArray<VizFinding>,
  replay: Replay,
): HTMLElement | null {
  return findingsSection(doc, notes(findings), {
    className: "state-notes",
    heading: "Naming notes",
    count: "data-notes",
    replay,
  });
}

/** Bugs about no single state (an event nobody handles); shown at the top of every Details view. */
function machineWide(doc: Document, machine: VizMachine, replay: Replay): HTMLElement | null {
  return findingsSection(
    doc,
    bugs(machineFindings(machine).filter((finding) => finding.state === null)),
    {
      className: "machine-findings",
      heading: "About the whole machine",
      count: "data-findings",
      replay,
    },
  );
}

function statePanel(
  doc: Document,
  state: VizState,
  context: {
    machine: VizMachine;
    select: (selection: Selection) => void;
    replay?: (steps: ReadonlyArray<VizStep>) => void;
  },
): HTMLElement {
  const { machine, select, replay } = context;
  const findings = machineFindings(machine).filter((finding) => finding.state === state.id);
  const flags = [state.initial ? "initial" : "", state.final ? "final" : ""].filter(Boolean);
  const outgoing = machine.edges.filter(
    (edge) => edge.from === state.id || (!state.final && coveredByAny(edge.from, state.id)),
  );
  const incoming = machine.edges.filter((edge) => edge.to === state.id && edge.kind !== "initial");
  return html(doc, "section", { class: "details", "data-selected-state": state.id }, [
    html(doc, "h2", {}, [`State ${state.id}`]),
    machineWide(doc, machine, replay),
    findingsSection(doc, bugs(findings), {
      className: "state-findings",
      heading: "Findings",
      count: "data-findings",
      replay,
    }),
    notesSection(doc, findings, replay),
    rulesSection(doc, machine, state.id),
    list(doc, [
      ["id", state.id],
      ["doc", state.doc ?? "none"],
      state.region !== null && machine.maps.includes(state.region)
        ? ["actor map", state.region]
        : ["region", state.region ?? "(root)"],
      ["flags", joined(flags)],
      [
        "effects on entry",
        joined(
          state.effects.map((effect) =>
            effect.sends === null
              ? effect.name
              : `${effect.name} (sends ${effect.sends.join(", ") || "nothing"})`,
          ),
        ),
      ],
      [machine.fuzz === null ? "run visits" : "fuzz visits", hitsText(state.coverage)],
      ["test visits", hitsText(state.tested)],
      ["outgoing", edgeList(doc, outgoing, select)],
      ["incoming", edgeList(doc, incoming, select)],
    ]),
  ]);
}

function fuzzSummary(doc: Document, machine: VizMachine): HTMLElement | null {
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
  machine: VizMachine,
  context: {
    selection: Selection | null;
    select: (selection: Selection) => void;
    replay?: (steps: ReadonlyArray<VizStep>) => void;
  },
): HTMLElement {
  const { selection } = context;
  if (selection?.kind === "edge") {
    const edge = machine.edges.find((candidate) => candidate.id === selection.id);
    if (edge) return edgePanel(doc, edge, { machine, replay: context.replay });
  }
  if (selection?.kind === "state") {
    const state = machine.states.find((candidate) => candidate.id === selection.id);
    if (state)
      return statePanel(doc, state, { machine, select: context.select, replay: context.replay });
  }
  const wide = machineFindings(machine).filter((finding) => finding.state === null);
  return html(doc, "div", {}, [
    machineWide(doc, machine, context.replay),
    notesSection(doc, wide, context.replay),
    fuzzSummary(doc, machine),
  ]);
}
