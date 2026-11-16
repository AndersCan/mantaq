import { movesFrom } from "../moves.ts";
import { coveredByAny } from "../schema.ts";
import { actorText, localName } from "./compartments.ts";
import type {
  VizActorRef,
  VizJson,
  VizLiveChild,
  VizRemovedChild,
  VizLiveState,
  VizLiveStep,
  VizLiveTimer,
  VizMachine,
  VizOutputRoutes,
  VizStep,
} from "../schema.ts";
import { html, svg } from "./dom.ts";
import { defaultValue, parseValue, valueFields, valueText } from "./fill.ts";
import type { Values } from "./fill.ts";
import { LOCK_SLOT, textWidth } from "./layout.ts";

export interface ExploreContext {
  machine: VizMachine;
  /** Keep the first `length` steps. */
  rewind: (length: number) => void;
  /** Set when a driver runs the actor: the panel shows its outcome and sends steps to it. */
  live?: {
    state: VizLiveState;
    /** Entry i is what moved after `state.steps[i]`, as the driver reported it then. */
    afters?: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
    /** Where each output of the shown machine goes; unset: only the output names show. */
    routes?: VizOutputRoutes;
    send: (step: VizStep) => void;
    /** The followed child; its row in the Step tab is marked. */
    picked?: { map: string; key: string } | null;
    /** The last Send press; its line leads the Step tab. */
    sent?: SentEvent | null;
    /** Send an event at once, with the values set in the Context tab. */
    sendEvent: (event: string, actor?: VizActorRef) => void;
    /** Field name → the value set in the Context tab. */
    values: Values;
    /** Set a field's value; undefined clears it. */
    setValue: (name: string, value: VizJson | undefined) => void;
  };
}

export function code(doc: Document, text: string): HTMLElement {
  return html(doc, "code", {}, [text]);
}

export function button(
  doc: Document,
  label: ReadonlyArray<Node | string>,
  context: {
    onClick: () => void;
    disabled?: boolean;
    attrs?: Record<string, string>;
  },
): HTMLButtonElement {
  const element = html(
    doc,
    "button",
    {
      type: "button",
      disabled: context.disabled ? "" : null,
      ...context.attrs,
    },
    label,
  );
  element.addEventListener("click", context.onClick);
  return element;
}

type ChildRef = { map: string; key: string };

/** The key, with the map name only when the machine has more than one map. */
function childWho(doc: Document, machine: VizMachine, ref: ChildRef): Array<Node | string> {
  return machine.maps.length > 1
    ? [code(doc, ref.map), " ", code(doc, ref.key)]
    : [code(doc, ref.key)];
}

function childWhoText(machine: VizMachine, ref: ChildRef): string {
  return machine.maps.length > 1 ? `${ref.map} ${ref.key}` : ref.key;
}

/** Children the step `n` first saw: live ones, then removed ones. */
function startedAt(state: VizLiveState, n: number): VizLiveChild[] {
  return [...state.children, ...(state.removed ?? [])].filter((child) => child.since === n);
}

function removedAt(state: VizLiveState, n: number): VizRemovedChild[] {
  return (state.removed ?? []).filter((child) => child.until === n);
}

/** The clock starts at 0 and only `advance` steps move it. */
function elapsed(steps: ReadonlyArray<VizStep>): number {
  return steps.reduce((sum, step) => sum + (step.kind === "advance" ? step.ms : 0), 0);
}

function timersSection(
  doc: Document,
  context: { state: VizLiveState; send: (step: VizStep) => void },
): HTMLElement | null {
  const now = elapsed(context.state.steps);
  if (context.state.timers.length === 0) return null;
  return html(doc, "div", { class: "explore-time" }, [
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
  ]);
}

interface LiveMoves {
  state: VizLiveState;
  picked?: { map: string; key: string } | null;
  sendEvent: (event: string, actor?: VizActorRef) => void;
}

/** A worker's Send buttons: one per event its state handles. */
function childSends(
  doc: Document,
  machine: VizMachine,
  context: { live: LiveMoves; child: VizActorRef; state: string },
): HTMLElement {
  const { live, child, state } = context;
  const events = [...new Set(movesFrom(machine, state).map((move) => move.edge.event))].sort();
  return html(doc, "div", { "data-actor": actorText(child) }, [
    html(
      doc,
      "ul",
      {},
      events.map((event) =>
        html(doc, "li", {}, [
          button(doc, ["Send ", code(doc, event)], {
            onClick: () => live.sendEvent(event, child),
            attrs: { "data-send": event },
          }),
        ]),
      ),
    ),
  ]);
}

/** One section per actor map: its walked child, where it is now, and what it handles. */
function childrenSections(
  doc: Document,
  machine: VizMachine,
  live: LiveMoves,
): Array<HTMLElement | null> {
  const { state } = live;
  return machine.maps.map((map) => {
    const followed = live.picked?.map === map ? live.picked.key : null;
    const rows = state.children
      .filter((child) => child.map === map)
      .map((child) => {
        const info = machine.states.find((each) => each.id === child.state);
        const final = info?.final === true;
        return html(
          doc,
          "li",
          {
            class: "explore-child",
            "data-child-map": map,
            "data-child-key": child.key,
            "data-child-state": child.state,
            ...(child.key === followed ? { "data-followed": "" } : {}),
          },
          [
            html(doc, "p", { class: "explore-now explore-child-now" }, [
              code(doc, child.key),
              ": in ",
              html(doc, "strong", {}, [localName(child.state)]),
              final ? " (final)" : "",
            ]),
            final
              ? null
              : childSends(doc, machine, {
                  live,
                  child: { map, key: child.key },
                  state: child.state,
                }),
          ],
        );
      });
    if (rows.length === 0) return null;
    return html(doc, "section", { class: "explore-map", "data-map": map }, [
      html(doc, "ul", { class: "explore-children" }, rows),
    ]);
  });
}

/** One text box per field name the machine's events carry; empty = the default shown in grey. */
function valuesList(
  doc: Document,
  context: {
    machine: VizMachine;
    live: NonNullable<ExploreContext["live"]>;
  },
): HTMLElement | null {
  const { machine, live } = context;
  const fields = valueFields(machine);
  if (fields.length === 0) return null;
  const rows = fields.map((field) => {
    const set = live.values[field.name];
    const shown = defaultValue(field, { live: live.state, afters: live.afters ?? [] });
    const input = html(doc, "input", {
      type: "text",
      "data-value": field.name,
      "aria-label": field.name,
      placeholder: shown === undefined ? "" : valueText(field, shown),
    });
    input.value = set === undefined ? "" : valueText(field, set);
    input.addEventListener("change", () => {
      const value = parseValue(field, input.value);
      if (value === undefined) input.value = "";
      live.setValue(field.name, value);
    });
    return html(doc, "label", { class: "explore-field" }, [
      html(doc, "span", {}, [
        html(doc, "strong", {}, [field.name]),
        " ",
        html(doc, "span", { class: "muted" }, [field.type]),
      ]),
      input,
    ]);
  });
  return html(doc, "div", { class: "explore-values", "data-values": "" }, [...rows]);
}

function localState(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}

/** The conditions that sent the handler to where this step went; null when the outcome did not depend on a condition. */
function becauseOf(machine: VizMachine, step: VizLiveStep): string[][] | null {
  if (step.outcome === "ignored") return null;
  const edge = machine.edges.find(
    (candidate) =>
      (candidate.kind === "transition" || candidate.kind === "stay") &&
      candidate.event === step.event &&
      (candidate.from === step.from || coveredByAny(candidate.from, step.from)) &&
      candidate.explanation?.status === "analyzed",
  );
  if (edge?.explanation?.status !== "analyzed") return null;
  const { branches } = edge.explanation;
  const targets = new Set(branches.map((branch) => JSON.stringify(branch.target)));
  if (targets.size <= 1) return null;
  const matching = branches.filter((branch) =>
    step.outcome === "stay"
      ? branch.target.kind === "stay"
      : branch.target.kind === "state" && branch.target.state === localState(step.to),
  );
  if (matching.every((branch) => branch.conditions.length === 0)) {
    return null;
  }
  return matching.map((branch) => branch.conditions);
}

/** What a Send press sent: the event, who got it, and its values when there are any. */
export type SentEvent = {
  event: string;
  actor?: VizActorRef;
  payload: VizJson | null;
  edge?: string;
};

export function sentEventLine(doc: Document, sent: SentEvent): Array<Node | string> {
  return [
    "Sent ",
    code(doc, sent.event),
    sent.actor === undefined
      ? ""
      : ` to ${"map" in sent.actor ? sent.actor.key : actorText(sent.actor)}`,
    sent.payload === null ? "" : ` with ${JSON.stringify(sent.payload)}`,
  ];
}

export function outcomeText(
  doc: Document,
  machine: VizMachine,
  step: VizLiveStep,
): Array<Node | string> {
  const region = step.actor === undefined ? undefined : actorText(step.actor);
  const child = step.actor !== undefined && "map" in step.actor ? step.actor : undefined;
  if (step.outcome === "missing") {
    return child === undefined
      ? ["No region ", code(doc, region ?? ""), " in this machine. Nothing ran."]
      : [code(doc, child.key), " is not in ", code(doc, child.map), ". Nothing ran."];
  }
  if (step.outcome === "ignored") {
    return ["No handler for ", code(doc, step.event), ` in ${step.from}. Nothing ran.`];
  }
  const names = (id: string) => (region === undefined ? id : localName(id));
  const where =
    child !== undefined
      ? [": ", ...childWho(doc, machine, child), " "]
      : region === undefined
        ? [": "]
        : [": ", code(doc, region), ": "];
  return [
    code(doc, step.event),
    ...where,
    step.outcome === "transition"
      ? `${names(step.from)} → ${names(step.to)}`
      : `handled in ${names(step.from)}, stays`,
  ];
}

function sentLine(
  doc: Document,
  context: { machine: VizMachine; step: VizLiveStep; routes: VizOutputRoutes | undefined },
): HTMLElement | null {
  const { machine, step, routes } = context;
  if (step.sent.length === 0) return null;
  return html(doc, "p", { "data-live-sent": "" }, [
    "Sent out: ",
    ...step.sent.flatMap((output, index) => {
      const found = routes?.[machine.id]?.[output] ?? [];
      return [
        index === 0 ? "" : "; ",
        code(doc, output),
        ...found.flatMap((route, at) => [
          at === 0 ? " → " : ", ",
          code(doc, route.to),
          " takes ",
          code(doc, route.event),
          ` (${route.at})`,
        ]),
      ];
    }),
  ]);
}

function notRunLine(doc: Document, context: { machine: VizMachine; step: VizLiveStep }) {
  const { machine, step } = context;
  const declared = machine.states.find((each) => each.id === step.to)?.effects ?? [];
  return html(doc, "p", { "data-live-not-run": "" }, [
    "Not run here: ",
    ...step.effects.flatMap((name, index) => {
      const sends = declared.find((each) => each.name === name)?.sends ?? [];
      return [
        index === 0 ? "" : "; ",
        code(doc, name),
        ...(sends.length === 0
          ? []
          : [
              " (it would send ",
              ...sends.flatMap((event, at) => [at === 0 ? "" : " or ", code(doc, event)]),
              ")",
            ]),
      ];
    }),
  ]);
}

function stepLines(
  doc: Document,
  context: {
    machine: VizMachine;
    step: VizLiveStep;
    held: boolean;
    routes: VizOutputRoutes | undefined;
  },
): Array<HTMLElement | null> {
  const { machine, step } = context;
  const because = becauseOf(machine, step);
  return [
    html(doc, "p", { "data-live-outcome": "" }, outcomeText(doc, machine, step)),
    because === null
      ? null
      : html(doc, "p", { "data-live-because": "" }, [
          because.length === 1 ? "Because: " : "Because one of: ",
          ...because.flatMap((conditions, index) => [
            index === 0 ? "" : "; ",
            code(doc, conditions.join(" && ")),
          ]),
        ]),
    sentLine(doc, { machine, step, routes: context.routes }),
    step.effects.length > 0 && context.held ? notRunLine(doc, { machine, step }) : null,
  ];
}

/** Which children the last step started (by state) and removed. */
function changedChildrenLines(doc: Document, state: VizLiveState): Array<HTMLElement> {
  const started = startedAt(state, state.steps.length);
  const groups = new Map<string, string[]>();
  for (const child of started) {
    groups.set(child.state, [...(groups.get(child.state) ?? []), child.key]);
  }
  const removed = removedAt(state, state.steps.length).map((child) => child.key);
  return [
    ...(started.length === 0
      ? []
      : [
          html(
            doc,
            "p",
            { "data-live-started": "", "data-keys": JSON.stringify(started.map((c) => c.key)) },
            [...groups].flatMap(([id, keys], index) => [
              index === 0 ? "" : "; ",
              ...keys.flatMap((key, at) => [at === 0 ? "" : ", ", code(doc, key)]),
              " started in ",
              localName(id),
            ]),
          ),
        ]),
    ...(removed.length === 0
      ? []
      : [
          html(doc, "p", { "data-live-removed": "", "data-keys": JSON.stringify(removed) }, [
            ...removed.flatMap((key, at) => [at === 0 ? "" : ", ", code(doc, key)]),
            " removed",
          ]),
        ]),
  ];
}

function liveResultSection(
  doc: Document,
  live: {
    machine: VizMachine;
    state: VizLiveState;
    routes: VizOutputRoutes | undefined;
    sent: SentEvent | null;
  },
): HTMLElement {
  const { machine, state, routes, sent } = live;
  const { last, after } = state;
  const held = state.effectMode === "held";
  return html(doc, "div", { class: "explore-live" }, [
    last === null
      ? null
      : html(doc, "div", { class: "explore-outcome", "data-outcome": last.outcome }, [
          sent === null
            ? null
            : html(doc, "p", { "data-live-sent-event": "" }, sentEventLine(doc, sent)),
          ...stepLines(doc, { machine, step: last, held, routes }),
          last.error === null
            ? null
            : html(
                doc,
                "p",
                {
                  class: "explore-warning",
                  role: "alert",
                  "data-live-error": "",
                },
                [`Handler threw: ${last.error}`],
              ),
          ...changedChildrenLines(doc, state),
          ...after.map((step) =>
            html(doc, "div", { "data-live-after": "" }, [
              afterLine(doc, { machine, step, last }),
              ...stepLines(doc, {
                machine,
                step,
                held,
                routes,
              }),
              step.error === null
                ? null
                : html(
                    doc,
                    "p",
                    {
                      class: "explore-warning",
                      role: "alert",
                      "data-live-error": "",
                    },
                    [`Handler threw: ${step.error}`],
                  ),
            ]),
          ),
        ]),
  ]);
}

function sameActor(left: VizActorRef | undefined, right: VizActorRef | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** What a moved part is called in a sentence: the machine, a region path, or a map child. */
function partName(machine: VizMachine, actor: VizActorRef | undefined): string {
  if (actor === undefined) return machine.id;
  return "region" in actor ? actor.region : childWhoText(machine, actor);
}

/** Whether a part had no handler for a message another part sent it. */
function isDropped(step: VizLiveStep): boolean {
  return step.message !== undefined && step.message.dropped !== null;
}

/** The sender as the row names it ("" is the machine itself); null when no part is known to have sent it. */
function senderName(machine: VizMachine, step: VizLiveStep): string | null {
  const sender = step.message?.sender ?? null;
  return sender === "" ? machine.id : sender;
}

/** The line above a later step: who sent it to whom, and where the receiver went; a dropped one says so and why. */
function afterLine(
  doc: Document,
  context: { machine: VizMachine; step: VizLiveStep; last: VizLiveStep },
): HTMLElement {
  const { machine, step, last } = context;
  const sender = senderName(machine, step);
  const receiver = partName(machine, step.actor);
  if (sender !== null && isDropped(step)) {
    return html(doc, "p", { "data-live-dropped": "" }, [
      "! Then ",
      `${sender} sent `,
      code(doc, step.event),
      ` to ${receiver}: dropped.`,
    ]);
  }
  if (sender !== null) {
    return html(doc, "p", { class: "muted" }, [
      `Then ${sender} sent `,
      code(doc, step.event),
      step.outcome === "transition"
        ? ` to ${receiver}: ${localName(step.from)} → ${localName(step.to)}`
        : ` to ${receiver}`,
    ]);
  }
  if (sameActor(step.actor, last.actor)) {
    return html(doc, "p", { class: "muted" }, ["Then ", code(doc, step.event), " came back"]);
  }
  return html(doc, "p", { class: "muted" }, [
    `Then ${receiver} took `,
    code(doc, step.event),
    step.outcome === "transition" ? `: ${localName(step.from)} → ${localName(step.to)}` : "",
  ]);
}

function nowSection(doc: Document, context: { current: string; final: boolean }): HTMLElement {
  const { current, final } = context;
  return html(doc, "p", { class: "explore-now" }, [
    "In ",
    html(doc, "strong", {}, [current]),
    final ? " (final)" : "",
  ]);
}

export interface ExploreParts {
  /** Where the walk is and what can happen next; null without a driver. */
  step: HTMLElement | null;
  /** Live only: the values events send; null when the machine's events carry no fields. */
  context: HTMLElement | null;
}

/** Live Step tab, below the root's state: regions, held effects, outcome, Send lists, time. */
function liveParts(
  doc: Document,
  machine: VizMachine,
  context: {
    live: NonNullable<ExploreContext["live"]>;
    current: string;
    final: boolean;
  },
): Array<HTMLElement | null> {
  const { live, final } = context;
  const { state } = live;
  const moves: LiveMoves = { state, picked: live.picked ?? null, sendEvent: live.sendEvent };
  return [
    liveResultSection(doc, {
      machine,
      state,
      routes: live.routes,
      sent: live.sent ?? null,
    }),
    ...childrenSections(doc, machine, moves),
    final ? null : timersSection(doc, { state, send: live.send }),
  ];
}

/** The walk, split for the panel's tabs. */
export function explorePanel(doc: Document, context: ExploreContext): ExploreParts {
  const { machine, live } = context;
  if (live === undefined) return { step: null, context: null };
  const current = live.state.state;
  const final = machine.states.find((state) => state.id === current)?.final === true;
  const length = live.state.steps.length;
  const step = html(
    doc,
    "section",
    {
      class: "explore",
      "data-current": current,
      "data-live-note": "",
      "data-effect-mode": live.state.effectMode,
      "data-done": final ? "" : null,
    },
    [
      nowSection(doc, { current, final }),
      ...liveParts(doc, machine, { live, current, final }),
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
    ],
  );
  return {
    step,
    context: valuesList(doc, { machine, live }),
  };
}

/** Mark the walk on the drawn graph: current state and possible next steps. */
export function markExplore(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    currents?: string[];
    /** Edge id → why its guard blocks it; these are not next steps and reach nothing. */
    blocked?: ReadonlyMap<string, string>;
  },
): void {
  const { machine } = context;
  const blocked = context.blocked ?? new Map<string, string>();
  const currents = context.currents ?? [];
  const moves = currents.flatMap((current) => movesFrom(machine, current));
  const open = moves.filter((move) => !blocked.has(move.edge.id));
  const next = new Set(open.filter((move) => move.targets.length > 0).map((move) => move.edge.id));
  const reachable = new Set(
    open.flatMap((move) => move.targets).filter((to) => !currents.includes(to)),
  );
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    element.classList.toggle("next", next.has(id));
    markBlocked(element, blocked.get(id));
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g.chip")) {
    element.classList.toggle("running", currents.includes(element.dataset["state"] ?? ""));
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-node-id]")) {
    const id = element.dataset["nodeId"];
    element.classList.toggle("current", id !== undefined && currents.includes(id));
    element.classList.toggle("reachable", id !== undefined && reachable.has(id));
  }
}

const LOCK_WIDTH = 8;
const LOCK_HEIGHT = 10;

/** A blocked arrow: grey lock left of the label's first line, and `aria-disabled`. */
function markBlocked(element: SVGGElement, reason: string | undefined): void {
  element.classList.toggle("blocked", reason !== undefined);
  element.querySelector(":scope > .blocked-lock")?.remove();
  if (reason === undefined) {
    element.removeAttribute("aria-disabled");
    return;
  }
  element.setAttribute("aria-disabled", "true");
  const doc = element.ownerDocument;
  const text = element.querySelector("text");
  const first = text?.querySelector("tspan");
  if (text === null || text === undefined || first === null || first === undefined) return;
  const left = Number(text.getAttribute("x")) - textWidth(first.textContent ?? "") / 2 - LOCK_SLOT;
  const top = Number(first.getAttribute("y") ?? text.getAttribute("y")) - LOCK_HEIGHT + 2;
  element.append(
    svg(doc, "g", { class: "blocked-lock", "aria-hidden": "true" }, [
      svg(doc, "rect", { x: left, y: top + 4, width: LOCK_WIDTH, height: LOCK_HEIGHT - 4 }),
      svg(doc, "path", {
        d: `M${left + 1.5} ${top + 4} V${top + 2.5} a2.5 2.5 0 0 1 5 0 V${top + 4}`,
      }),
    ]),
  );
}
