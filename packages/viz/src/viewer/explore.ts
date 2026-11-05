import { movesFrom, payloadSamples, stateAfter, unhandledSends } from "../moves.ts";
import type { ExploreStep, Move, MoveGroup } from "../moves.ts";
import type {
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizLiveTimer,
  VizMachine,
  VizStep,
} from "../schema.ts";
import { html } from "./dom.ts";
import type { Selection } from "./graph.ts";

export interface ExploreContext {
  machine: VizMachine;
  path: ReadonlyArray<ExploreStep>;
  take: (step: ExploreStep) => void;
  /** Keep the first `length` steps. */
  rewind: (length: number) => void;
  /** Set when a driver runs the actor: the panel shows its outcome and sends steps to it. */
  live?: { state: VizLiveState; send: (step: VizStep) => void };
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

function docNote(doc: Document, note: { text: string | null; scope: string }): HTMLElement | null {
  return note.text === null
    ? null
    : html(doc, "p", { class: "doc", "data-doc": note.scope }, [note.text]);
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
      docNote(doc, { text: edge.doc, scope: "edge" }),
    ]);
  }
  return html(doc, "li", { "data-move": edge.id }, [
    ...move.targets.map((target) =>
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
    docNote(doc, { text: edge.doc, scope: "edge" }),
  ]);
}

function effectsSection(doc: Document, machine: VizMachine, current: string): HTMLElement | null {
  const effects = machine.states.find((state) => state.id === current)?.effects ?? [];
  if (effects.length === 0) return null;
  const unhandled = unhandledSends(machine, current);
  const isUnhandled = (effect: string, event: string) =>
    unhandled.some((each) => each.effect === effect && each.event === event);
  const effectDoc = machine.edges.find(
    (edge) => edge.kind === "effect" && edge.from === current,
  )?.doc;
  return html(doc, "div", { class: "explore-effects" }, [
    html(doc, "p", {}, [`Entering ${current} runs:`]),
    docNote(doc, { text: effectDoc ?? null, scope: "edge" }),
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
    return html(doc, "p", { class: "explore-end explore-done", role: "status" }, [
      html(doc, "strong", {}, ["Done."]),
      ` ${context.current} is final: the actor has stopped.`,
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

function describeStep(step: VizStep): string {
  if (step.kind === "advance") return `advance ${step.ms} ms`;
  return step.payload === null ? step.event : `${step.event} ${JSON.stringify(step.payload)}`;
}

/** The clock starts at 0 and only `advance` steps move it. */
function elapsed(steps: ReadonlyArray<VizStep>): number {
  return steps.reduce((sum, step) => sum + (step.kind === "advance" ? step.ms : 0), 0);
}

function timersSection(
  doc: Document,
  context: { state: VizLiveState; send: (step: VizStep) => void },
): HTMLElement {
  const now = elapsed(context.state.steps);
  const input = html(doc, "input", {
    type: "number",
    min: "0",
    value: "100",
    "aria-label": "milliseconds",
    "data-advance-ms": "",
  });
  const problem = html(doc, "p", { class: "explore-warning", role: "alert", hidden: "" }, [
    "Enter a number of milliseconds, 0 or more.",
  ]);
  const advance = () => {
    const ms = Number(input.value);
    const valid = input.value.trim() !== "" && Number.isFinite(ms) && ms >= 0;
    problem.toggleAttribute("hidden", valid);
    if (valid) context.send({ kind: "advance", ms });
  };
  return html(doc, "div", { class: "explore-time" }, [
    html(doc, "h3", {}, ["Time"]),
    html(
      doc,
      "ul",
      { "data-group": "timers" },
      context.state.timers.map((timer: VizLiveTimer) => {
        const remaining = Math.max(0, timer.deadline - now);
        return html(doc, "li", { "data-timer": timer.id }, [
          button(doc, [`advance ${remaining} ms → ${timer.eventName ?? timer.id}`], {
            onClick: () => context.send({ kind: "advance", ms: remaining }),
            attrs: { "data-advance-timer": timer.id },
          }),
        ]);
      }),
    ),
    context.state.timers.length === 0
      ? html(doc, "p", { class: "muted", "data-no-timers": "" }, ["No timers pending."])
      : null,
    html(doc, "div", {}, [
      input,
      " ms ",
      button(doc, ["advance"], { onClick: advance, attrs: { "data-advance": "" } }),
    ]),
    problem,
  ]);
}

function liveMovesSection(
  doc: Document,
  machine: VizMachine,
  context: { state: VizLiveState; send: (step: VizStep) => void; final: boolean },
): HTMLElement {
  const current = context.state.state;
  if (context.final) {
    return html(doc, "p", { class: "explore-end explore-done", role: "status" }, [
      html(doc, "strong", {}, ["Done."]),
      ` ${current} is final: the actor has stopped.`,
    ]);
  }
  const handled = new Set(movesFrom(machine, current).map((move) => move.edge.event));
  const inputs = machine.events.filter((event) => !event.internal).map((event) => event.id);
  const events = [...new Set([...handled, ...inputs])].sort();
  const json = html(doc, "textarea", {
    rows: "2",
    placeholder: "payload as JSON (empty: the sample, or none)",
    "aria-label": "payload JSON",
    "data-payload-json": "",
  });
  const problem = html(doc, "p", { class: "explore-warning", role: "alert", hidden: "" }, [
    "Payload is not valid JSON.",
  ]);
  const payloadFor = (sample: HTMLSelectElement | null): { value: VizJson } | null => {
    try {
      if (json.value.trim() !== "") return { value: JSON.parse(json.value) as VizJson };
      return { value: sample === null || sample.value === "" ? null : JSON.parse(sample.value) };
    } catch {
      return null;
    }
  };
  return html(doc, "div", { class: "explore-moves" }, [
    html(doc, "h3", {}, ["Send"]),
    json,
    problem,
    html(
      doc,
      "ul",
      { "data-group": "live" },
      events.map((event) => {
        const samples = payloadSamples(machine, event);
        const sample =
          samples.length === 0
            ? null
            : html(
                doc,
                "select",
                { "aria-label": `${event} payload sample`, "data-sample": event },
                [
                  html(doc, "option", { value: "" }, ["no payload"]),
                  ...samples.map((each) =>
                    html(doc, "option", { value: JSON.stringify(each) }, [JSON.stringify(each)]),
                  ),
                ],
              );
        return html(doc, "li", { "data-send-item": event }, [
          button(doc, [code(doc, event)], {
            onClick: () => {
              const payload = payloadFor(sample);
              problem.toggleAttribute("hidden", payload !== null);
              if (payload !== null) context.send({ kind: "event", event, payload: payload.value });
            },
            attrs: { "data-send": event },
          }),
          sample,
          handled.has(event)
            ? null
            : html(doc, "span", { class: "muted", "data-ignored": "" }, [` ignored in ${current}`]),
        ]);
      }),
    ),
  ]);
}

function outcomeText(last: VizLiveStep): string {
  if (last.outcome === "transition") return ` ${last.from} → ${last.to}`;
  if (last.outcome === "stay") return ` handled in ${last.from}: stays`;
  return ` ignored in ${last.from}: no handler`;
}

const collapsedContexts = new WeakSet<Document>();

/** Collapsible, pretty-printed context. The fold survives the panel redraw after each step. */
function contextSection(doc: Document, value: unknown): HTMLElement {
  const section = html(doc, "details", { class: "explore-context", "data-live-context": "" }, [
    html(doc, "summary", {}, ["Context"]),
    html(doc, "pre", {}, [JSON.stringify(value, null, 2) ?? "undefined"]),
  ]);
  section.open = !collapsedContexts.has(doc);
  section.addEventListener("toggle", () => {
    if (section.open) collapsedContexts.delete(doc);
    else collapsedContexts.add(doc);
  });
  return section;
}

function liveResultSection(doc: Document, state: VizLiveState): HTMLElement {
  const { last } = state;
  return html(doc, "div", { class: "explore-live" }, [
    last === null
      ? html(doc, "p", { class: "muted" }, ["Nothing has run yet."])
      : html(doc, "div", { class: "explore-outcome", "data-outcome": last.outcome }, [
          html(doc, "p", {}, [code(doc, last.event), outcomeText(last)]),
          last.effects.length === 0
            ? null
            : html(doc, "p", { "data-live-effects": "" }, [
                "Effects run: ",
                ...last.effects.flatMap((name, index) => [
                  index === 0 ? "" : ", ",
                  code(doc, name),
                ]),
              ]),
          last.error === null
            ? null
            : html(doc, "p", { class: "explore-warning", role: "alert", "data-live-error": "" }, [
                `Handler threw: ${last.error}`,
              ]),
        ]),
    contextSection(doc, state.context),
  ]);
}

function livePathSection(doc: Document, context: ExploreContext, state: VizLiveState): HTMLElement {
  return html(doc, "div", { class: "explore-path" }, [
    html(doc, "h3", {}, ["Path"]),
    html(doc, "ol", {}, [
      html(doc, "li", { "aria-current": state.steps.length === 0 ? "step" : null }, [
        button(doc, ["start"], {
          onClick: () => context.rewind(0),
          attrs: { "data-rewind": "0" },
        }),
      ]),
      ...state.steps.map((step, index) =>
        html(doc, "li", { "aria-current": index === state.steps.length - 1 ? "step" : null }, [
          button(doc, [describeStep(step)], {
            onClick: () => context.rewind(index + 1),
            attrs: { "data-rewind": String(index + 1) },
          }),
        ]),
      ),
    ]),
  ]);
}

function nowSection(
  doc: Document,
  machine: VizMachine,
  context: { current: string; final: boolean },
): Array<HTMLElement | null> {
  const { current, final } = context;
  return [
    html(doc, "p", { class: "explore-now" }, [
      "In ",
      html(doc, "strong", {}, [current]),
      final ? " (final)" : "",
    ]),
    docNote(doc, {
      text: machine.states.find((state) => state.id === current)?.doc ?? null,
      scope: "state",
    }),
  ];
}

/** Side-panel section: where the walk is, what can happen next, and how it got here. */
export function explorePanel(doc: Document, context: ExploreContext): HTMLElement {
  const { machine, path, live } = context;
  const current = live?.state.state ?? stateAfter(machine, path) ?? "";
  const final = machine.states.find((state) => state.id === current)?.final === true;
  const length = live?.state.steps.length ?? path.length;
  return html(
    doc,
    "section",
    { class: "explore", "data-current": current, "data-done": final ? "" : null },
    [
      html(doc, "h2", {}, ["Explore"]),
      ...nowSection(doc, machine, { current, final }),
      ...(live
        ? [
            liveResultSection(doc, live.state),
            liveMovesSection(doc, machine, { state: live.state, send: live.send, final }),
            final ? null : timersSection(doc, { state: live.state, send: live.send }),
          ]
        : [
            effectsSection(doc, machine, current),
            movesSection(doc, movesFrom(machine, current), { current, final, take: context.take }),
          ]),
      html(doc, "div", { class: "explore-controls" }, [
        button(doc, ["Back"], {
          onClick: () => context.rewind(length - 1),
          disabled: length === 0,
          attrs: { "data-explore-action": "back" },
        }),
        button(doc, ["Reset"], {
          onClick: () => context.rewind(0),
          disabled: length === 0,
          attrs: { "data-explore-action": "reset" },
        }),
      ]),
      live ? livePathSection(doc, context, live.state) : pathSection(doc, context),
    ],
  );
}

/**
 * Where a click on the diagram moves the walk, or null to just show details:
 * a next-step edge with one target, or a state exactly one next step reaches.
 */
export function clickStep(
  machine: VizMachine,
  context: { path: ReadonlyArray<ExploreStep>; selection: Selection; live?: string },
): ExploreStep | null {
  const current = context.live ?? stateAfter(machine, context.path);
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
  context: { machine: VizMachine; path: ReadonlyArray<ExploreStep>; live?: string },
): void {
  const { machine, path } = context;
  const current = context.live ?? stateAfter(machine, path);
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
