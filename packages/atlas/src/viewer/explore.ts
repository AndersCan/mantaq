import { movesFrom, stateAfter, unhandledSends } from "../moves.ts";
import type { ExploreStep, Move, MoveGroup } from "../moves.ts";
import type { AtlasMachine } from "../schema.ts";
import { html } from "./dom.ts";
import type { Selection } from "./graph.ts";

export interface ExploreContext {
  machine: AtlasMachine;
  path: ReadonlyArray<ExploreStep>;
  take: (step: ExploreStep) => void;
  /** Keep the first `length` steps. */
  rewind: (length: number) => void;
}

const GROUP_TITLES: Record<MoveGroup, string> = {
  input: "Send an input",
  effect: "Effect reports back",
  internal: "Other internal events",
};

function code(doc: Document, text: string): HTMLElement {
  return html(doc, "code", {}, [text]);
}

function button(
  doc: Document,
  label: ReadonlyArray<Node | string>,
  context: { onClick: () => void; disabled?: boolean; attrs?: Record<string, string> },
): HTMLButtonElement {
  const element = html(
    doc,
    "button",
    { type: "button", disabled: context.disabled ? "" : null, ...context.attrs },
    label,
  );
  element.addEventListener("click", context.onClick);
  return element;
}

function targetText(move: Move, target: string, current: string): string {
  return target === current && move.edge.kind === "stay" ? "stays" : `→ ${target}`;
}

function moveItem(
  doc: Document,
  move: Move,
  context: { current: string; take: (step: ExploreStep) => void },
): HTMLLIElement {
  const { edge } = move;
  const via =
    edge.from === context.current ? null : html(doc, "span", { class: "muted" }, [" (any state)"]);
  if (move.targets.length === 0) {
    return html(doc, "li", { "data-move": edge.id }, [
      code(doc, edge.event),
      via,
      html(doc, "span", { class: "muted" }, [" → ? target depends on payload or context"]),
    ]);
  }
  return html(
    doc,
    "li",
    { "data-move": edge.id },
    move.targets.map((target) =>
      button(
        doc,
        [
          code(doc, edge.event),
          ` ${targetText(move, target, context.current)}`,
          ...(via ? [via] : []),
        ],
        {
          onClick: () => context.take({ edge: edge.id, to: target }),
          attrs: { "data-take": edge.id, "data-target": target },
        },
      ),
    ),
  );
}

function effectsSection(doc: Document, machine: AtlasMachine, current: string): HTMLElement | null {
  const effects = machine.states.find((state) => state.id === current)?.effects ?? [];
  if (effects.length === 0) return null;
  const unhandled = unhandledSends(machine, current);
  const isUnhandled = (effect: string, event: string) =>
    unhandled.some((each) => each.effect === effect && each.event === event);
  return html(doc, "div", { class: "explore-effects" }, [
    html(doc, "p", {}, [`Entering ${current} runs:`]),
    html(
      doc,
      "ul",
      {},
      effects.map((effect) => {
        const sends = effect.sends ?? [];
        const summary =
          effect.sends === null
            ? html(doc, "span", { class: "muted" }, [" (sends not declared)"])
            : sends.length === 0
              ? " sends nothing"
              : " sends ";
        return html(doc, "li", { "data-effect": effect.name }, [
          code(doc, effect.name),
          summary,
          ...sends.flatMap((event, index) => [
            index === 0 ? "" : ", ",
            html(doc, "span", { class: isUnhandled(effect.name, event) ? "unhandled" : null }, [
              code(doc, event),
            ]),
          ]),
        ]);
      }),
    ),
    unhandled.length === 0
      ? null
      : html(doc, "p", { class: "explore-warning", role: "note" }, [
          `No handler in ${current} for `,
          ...unhandled.flatMap((each, index) => [index === 0 ? "" : ", ", code(doc, each.event)]),
          ": the actor ignores it.",
        ]),
  ]);
}

function movesSection(
  doc: Document,
  moves: ReadonlyArray<Move>,
  context: { current: string; final: boolean; take: (step: ExploreStep) => void },
): HTMLElement {
  if (context.final) {
    return html(doc, "p", { class: "explore-end" }, [
      `${context.current} is final: the actor has stopped.`,
    ]);
  }
  if (moves.length === 0) {
    return html(doc, "p", { class: "explore-end" }, [`No handler in ${context.current}: stuck.`]);
  }
  const groups: MoveGroup[] = ["input", "effect", "internal"];
  return html(
    doc,
    "div",
    { class: "explore-moves" },
    groups.flatMap((group) => {
      const inGroup = moves.filter((move) => move.group === group);
      if (inGroup.length === 0) return [];
      return [
        html(doc, "h3", {}, [GROUP_TITLES[group]]),
        html(
          doc,
          "ul",
          { "data-group": group },
          inGroup.map((move) => moveItem(doc, move, context)),
        ),
      ];
    }),
  );
}

function pathSection(doc: Document, context: ExploreContext): HTMLElement {
  const { machine, path } = context;
  const edges = new Map(machine.edges.map((edge) => [edge.id, edge]));
  let from = machine.initial ?? "";
  const items = path.map((step, index) => {
    const event = edges.get(step.edge)?.event ?? step.edge;
    const text = step.to === from ? `${event} in ${from}: stays` : `${event}: ${from} → ${step.to}`;
    from = step.to;
    return html(doc, "li", { "aria-current": index === path.length - 1 ? "step" : null }, [
      button(doc, [text], {
        onClick: () => context.rewind(index + 1),
        attrs: { "data-rewind": String(index + 1) },
      }),
    ]);
  });
  return html(doc, "div", { class: "explore-path" }, [
    html(doc, "h3", {}, ["Path"]),
    html(doc, "ol", {}, [
      html(doc, "li", { "aria-current": path.length === 0 ? "step" : null }, [
        button(doc, [`start in ${machine.initial ?? "?"}`], {
          onClick: () => context.rewind(0),
          attrs: { "data-rewind": "0" },
        }),
      ]),
      ...items,
    ]),
  ]);
}

/** Side-panel section: where the walk is, what can happen next, and how it got here. */
export function explorePanel(doc: Document, context: ExploreContext): HTMLElement {
  const { machine, path } = context;
  const current = stateAfter(machine, path) ?? "";
  const final = machine.states.find((state) => state.id === current)?.final === true;
  const moves = movesFrom(machine, current);
  return html(doc, "section", { class: "explore", "data-current": current }, [
    html(doc, "h2", {}, ["Explore"]),
    html(doc, "p", { class: "explore-now" }, [
      "In ",
      html(doc, "strong", {}, [current]),
      final ? " (final)" : "",
    ]),
    effectsSection(doc, machine, current),
    movesSection(doc, moves, { current, final, take: context.take }),
    html(doc, "div", { class: "explore-controls" }, [
      button(doc, ["Back"], {
        onClick: () => context.rewind(path.length - 1),
        disabled: path.length === 0,
        attrs: { "data-explore-action": "back" },
      }),
      button(doc, ["Reset"], {
        onClick: () => context.rewind(0),
        disabled: path.length === 0,
        attrs: { "data-explore-action": "reset" },
      }),
    ]),
    pathSection(doc, context),
  ]);
}

/**
 * Where a click on the diagram moves the walk, or null to just show details:
 * a next-step edge with one target, or a state exactly one next step reaches.
 */
export function clickStep(
  machine: AtlasMachine,
  context: { path: ReadonlyArray<ExploreStep>; selection: Selection },
): ExploreStep | null {
  const current = stateAfter(machine, context.path);
  if (current === null) return null;
  const { selection } = context;
  const steps = movesFrom(machine, current).flatMap((move) =>
    move.targets.map((to) => ({ edge: move.edge.id, to })),
  );
  const matching =
    selection.kind === "edge"
      ? steps.filter((step) => step.edge === selection.id)
      : steps.filter((step) => step.to === selection.id && step.to !== current);
  return matching.length === 1 ? (matching[0] ?? null) : null;
}

/** Mark the walk on the drawn graph: current state, path taken, possible next steps. */
export function markExplore(
  root: HTMLElement,
  context: { machine: AtlasMachine; path: ReadonlyArray<ExploreStep> },
): void {
  const { machine, path } = context;
  const current = stateAfter(machine, path);
  const moves = current === null ? [] : movesFrom(machine, current);
  const next = new Set(moves.filter((move) => move.targets.length > 0).map((move) => move.edge.id));
  const reachable = new Set(moves.flatMap((move) => move.targets).filter((to) => to !== current));
  const taken = new Set(path.map((step) => step.edge));
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    element.classList.toggle("taken", taken.has(id));
    element.classList.toggle("next", next.has(id));
    element.classList.toggle(
      "running",
      element.classList.contains("effect") && element.dataset["from"] === current,
    );
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-node-id]")) {
    const id = element.dataset["nodeId"];
    element.classList.toggle("current", id === current);
    element.classList.toggle("reachable", id !== undefined && reachable.has(id));
  }
}
