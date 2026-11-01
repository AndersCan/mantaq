import { isAnyState } from "../schema.ts";
import type { AtlasJourney, AtlasJourneyMove, AtlasMachine, AtlasStep } from "../schema.ts";
import { activatable, html } from "./dom.ts";
import type { Selection } from "./graph.ts";

/** A journey being walked: `at` moves taken so far (0 = at the start). */
export interface JourneyView {
  journey: AtlasJourney;
  at: number;
}

export function findJourney(machine: AtlasMachine, id: string): AtlasJourney | undefined {
  return machine.journeys.find((journey) => journey.id === id);
}

/** State the actor is in after `at` moves. */
function stateAt(view: JourneyView): string {
  return view.journey.moves[view.at - 1]?.to ?? view.journey.start;
}

/** Effects that ran on entering the current state. */
function effectsAt(view: JourneyView, machine: AtlasMachine): string[] {
  const last = view.journey.moves[view.at - 1];
  if (last !== undefined) return last.outcome === "transition" ? last.effects : [];
  return machine.states.find((state) => state.id === view.journey.start)?.effects ?? [];
}

/** States and edges the journey touches; everything else is dimmed and inert. */
function pathOf(journey: AtlasJourney, machine: AtlasMachine): Set<string> {
  const states = new Set([journey.start, ...journey.moves.flatMap((move) => [move.from, move.to])]);
  const edges = new Set(journey.moves.flatMap((move) => move.edge ?? []));
  const anySources = machine.edges
    .filter((edge) => edges.has(edge.id) && isAnyState(edge.from))
    .map((edge) => edge.from);
  const effects = machine.edges
    .filter((edge) => edge.kind === "effect" && states.has(edge.from))
    .map((edge) => edge.id);
  return new Set([...states, ...edges, ...anySources, ...effects]);
}

function elementId(element: SVGGElement): string | undefined {
  return element.dataset["edgeId"] ?? element.dataset["nodeId"];
}

/**
 * Mark the walk on the drawn graph: path vs off-path, edges already taken,
 * the edge to click next, the current state and the effects it just ran.
 * Off-path elements leave the tab order: only the journey can be clicked.
 */
export function markJourney(
  root: HTMLElement,
  context: { machine: AtlasMachine; view: JourneyView },
): void {
  const { machine, view } = context;
  root.classList.add("journey-on");
  const path = pathOf(view.journey, machine);
  const moves = view.journey.moves;
  const taken = new Set(moves.slice(0, view.at).flatMap((move) => move.edge ?? []));
  const next = moves[view.at]?.edge ?? null;
  const current = stateAt(view);
  const running = effectsAt(view, machine).length > 0;
  for (const element of root.querySelectorAll<SVGGElement>(
    ".graph g[data-edge-id], .graph g[data-node-id]",
  )) {
    const id = elementId(element) ?? "";
    const onPath = path.has(id);
    const isEffect = element.classList.contains("effect");
    element.classList.toggle("off-path", !onPath);
    element.classList.toggle("taken", taken.has(id));
    element.classList.toggle("next", next === id);
    element.classList.toggle("current", element.dataset["nodeId"] === current);
    element.classList.toggle("running", running && isEffect && element.dataset["from"] === current);
    if (element.getAttribute("role") !== "button") continue;
    element.setAttribute("tabindex", onPath ? "0" : "-1");
    element.setAttribute("aria-disabled", String(!onPath));
  }
}

/**
 * Where a click on the diagram moves the walk: the next edge advances one
 * step; an edge or state already on the path jumps to when it was reached.
 * Anything off the path does nothing (null).
 */
export function clickTarget(
  view: JourneyView,
  context: { machine: AtlasMachine; selection: Selection },
): number | null {
  const { journey } = view;
  const { selection } = context;
  if (selection.kind === "edge") {
    if (journey.moves[view.at]?.edge === selection.id) return view.at + 1;
    const index = journey.moves.findIndex((move) => move.edge === selection.id);
    if (index !== -1) return index + 1;
    const effect = context.machine.edges.find(
      (edge) => edge.id === selection.id && edge.kind === "effect",
    );
    return effect === undefined ? null : reachedAt(journey, effect.from);
  }
  return reachedAt(journey, selection.id);
}

function reachedAt(journey: AtlasJourney, state: string): number | null {
  if (state === journey.start) return 0;
  const index = journey.moves.findIndex((move) => move.to === state);
  return index === -1 ? null : index + 1;
}

function stepText(step: AtlasStep): string {
  return step.kind === "advance" ? `${step.ms}ms pass` : step.event;
}

function code(doc: Document, text: string): HTMLElement {
  return html(doc, "code", {}, [text]);
}

function moveLine(doc: Document, move: AtlasJourneyMove, step: AtlasStep | undefined): HTMLElement {
  const trigger = code(doc, move.event || (step ? stepText(step) : "time"));
  if (move.outcome === "ignored") {
    return html(doc, "span", {}, [trigger, ` in ${move.from}: not handled, nothing happens`]);
  }
  if (move.outcome === "stay") {
    return html(doc, "span", {}, [trigger, ` in ${move.from}: handled, stays`]);
  }
  return html(doc, "span", {}, [trigger, `: ${move.from} → ${move.to}`]);
}

function effectsLine(
  doc: Document,
  context: { state: string; effects: string[] },
): HTMLElement | null {
  if (context.effects.length === 0) return null;
  return html(doc, "p", { class: "journey-effects" }, [
    `Entering ${context.state} runs `,
    ...context.effects.flatMap((name, index) => [index === 0 ? "" : ", ", code(doc, name)]),
    ".",
  ]);
}

/** Note of the input behind a move, shown once on the first move it caused. */
function noteOf(journey: AtlasJourney, index: number): string | null {
  const move = journey.moves[index];
  if (move === undefined) return null;
  if (journey.moves[index - 1]?.input === move.input) return null;
  return journey.inputs[move.input]?.note ?? null;
}

function nowSection(doc: Document, view: JourneyView, machine: AtlasMachine): HTMLElement {
  const { journey, at } = view;
  const last = journey.moves[at - 1];
  const state = stateAt(view);
  const final = machine.states.find((each) => each.id === state)?.final === true;
  const nextMove = journey.moves[at];
  const happened =
    last === undefined
      ? html(doc, "p", {}, ["Starts in ", html(doc, "strong", {}, [state]), "."])
      : html(doc, "p", {}, [moveLine(doc, last, journey.inputs[last.input]?.step)]);
  const note = last === undefined ? null : noteOf(journey, at - 1);
  const upcoming =
    nextMove === undefined
      ? html(doc, "p", { class: "journey-next" }, [
          final ? `Done: ${state} is final.` : `End of journey, in ${state}.`,
        ])
      : html(doc, "p", { class: "journey-next" }, [
          "Next: ",
          code(doc, nextMove.event || "time passes"),
          nextMove.edge === null ? " (use Next)" : " (click the highlighted edge, or Next)",
        ]);
  return html(doc, "div", { class: "journey-now", "aria-live": "polite" }, [
    happened,
    note === null ? null : html(doc, "p", { class: "journey-note" }, [note]),
    effectsLine(doc, { state, effects: effectsAt(view, machine) }),
    upcoming,
  ]);
}

function button(
  doc: Document,
  label: string,
  context: { onClick: () => void; disabled?: boolean; name: string },
): HTMLButtonElement {
  const element = html(
    doc,
    "button",
    { type: "button", "data-journey-action": context.name, disabled: context.disabled ? "" : null },
    [label],
  );
  element.addEventListener("click", context.onClick);
  return element;
}

function moveList(doc: Document, view: JourneyView, go: (at: number) => void): HTMLOListElement {
  return html(
    doc,
    "ol",
    { class: "journey-moves" },
    view.journey.moves.map((move, index) => {
      const note = noteOf(view.journey, index);
      const item = html(
        doc,
        "li",
        {
          class: index < view.at ? "done" : index === view.at ? "upcoming" : "later",
          "aria-current": index === view.at - 1 ? "step" : null,
        },
        [
          moveLine(doc, move, view.journey.inputs[move.input]?.step),
          note === null ? null : html(doc, "div", { class: "muted" }, [note]),
        ],
      );
      activatable(item, () => go(index + 1));
      return item;
    }),
  );
}

/** Side panel while walking a journey: narration, controls, and every move. */
export function journeyPanel(
  doc: Document,
  context: { machine: AtlasMachine; view: JourneyView; go: (at: number) => void; exit: () => void },
): HTMLElement {
  const { view, go } = context;
  const total = view.journey.moves.length;
  return html(doc, "section", { class: "journey", "data-journey": view.journey.id }, [
    html(doc, "h2", {}, [view.journey.title]),
    view.journey.description === null
      ? null
      : html(doc, "p", { class: "muted" }, [view.journey.description]),
    html(doc, "p", { class: "journey-progress" }, [`Step ${view.at} of ${total}`]),
    nowSection(doc, view, context.machine),
    html(doc, "div", { class: "journey-controls" }, [
      button(doc, "Restart", { name: "restart", onClick: () => go(0), disabled: view.at === 0 }),
      button(doc, "Back", {
        name: "back",
        onClick: () => go(view.at - 1),
        disabled: view.at === 0,
      }),
      button(doc, "Next", {
        name: "next",
        onClick: () => go(view.at + 1),
        disabled: view.at >= total,
      }),
      button(doc, "Exit", { name: "exit", onClick: context.exit }),
    ]),
    moveList(doc, view, go),
  ]);
}

/** "How we handle X" list for the idle panel; each entry starts its walk. */
export function journeyList(
  doc: Document,
  context: { machine: AtlasMachine; start: (id: string) => void },
): HTMLElement | null {
  const { journeys } = context.machine;
  if (journeys.length === 0) return null;
  return html(doc, "section", { class: "journeys" }, [
    html(doc, "h2", {}, ["Journeys"]),
    html(
      doc,
      "ul",
      {},
      journeys.map((journey) => {
        const link = html(doc, "span", { class: "link", "data-journey-link": journey.id }, [
          journey.title,
        ]);
        activatable(link, () => context.start(journey.id));
        return html(doc, "li", {}, [
          link,
          journey.description === null
            ? null
            : html(doc, "div", { class: "muted" }, [journey.description]),
        ]);
      }),
    ),
  ]);
}
