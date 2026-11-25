import { movesFrom } from "../moves.ts";
import { actorText, localName } from "./compartments.ts";
import type {
  VizActorRef,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizLiveTimer,
  VizMachine,
  VizOutputRoutes,
  VizStep,
} from "../schema.ts";
import { activatable, html, svg } from "./dom.ts";
import { contextView } from "./context/context-view.ts";
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
    lasts: ReadonlyArray<VizLiveStep | null>;
    /** Where each output of the shown machine goes; unset: only the output names show. */
    routes?: VizOutputRoutes;
    send: (step: VizStep) => void;
    /** The followed child; its row in the Step tab is marked. */
    picked?: { map: string; key: string } | null;
    /** Follow this child: Send in the map goes to it. */
    pick: (child: { map: string; key: string }) => void;
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

export function childWhoText(machine: VizMachine, ref: ChildRef): string {
  return machine.maps.length > 1 ? `${ref.map} ${ref.key}` : ref.key;
}

/** The clock starts at 0 and only `advance` steps move it. */
export function elapsed(steps: ReadonlyArray<VizStep>): number {
  return steps.reduce((sum, step) => sum + (step.kind === "advance" ? step.ms : 0), 0);
}

function timersSection(
  doc: Document,
  context: { state: VizLiveState; send: (step: VizStep) => void },
): HTMLElement | null {
  const now = elapsed(context.state.steps);
  if (context.state.timers.length === 0) return null;
  return html(
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
  );
}

interface LiveMoves {
  state: VizLiveState;
  picked?: { map: string; key: string } | null;
  pick: (child: { map: string; key: string }) => void;
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
        const li = html(
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
            ]),
          ],
        );
        li.setAttribute("aria-pressed", child.key === followed ? "true" : "false");
        activatable(li, () => live.pick({ map, key: child.key }));
        return li;
      });
    if (rows.length === 0) return null;
    return html(doc, "section", { class: "explore-map", "data-map": map }, [
      html(doc, "ul", { class: "explore-children" }, rows),
    ]);
  });
}

/** What a Send press sent: the event, who got it, and its values when there are any. */
export type SentEvent = {
  event: string;
  actor?: VizActorRef;
  payload: VizJson | null;
  edge?: string;
  /** Why the guard blocked the arrow when it was sent. */
  blocked?: string;
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
  const names = (id: string) => (region === undefined ? id : localName(id));
  const to = step.actor === undefined ? "" : ` to ${partName(machine, step.actor)}`;
  return [code(doc, step.event), `${to}: `, tailText(step, names)];
}

function tailText(step: VizLiveStep, names: (id: string) => string): string {
  if (step.outcome === "transition") return `${names(step.from)} → ${names(step.to)}`;
  if (step.outcome === "stay") return `stayed in ${names(step.from)}`;
  return `lost, nobody took it in ${names(step.from)}`;
}

/** What a moved part is called in a sentence: the machine, a region path, or a map child. */
function partName(machine: VizMachine, actor: VizActorRef | undefined): string {
  if (actor === undefined) return machine.id;
  return "region" in actor ? actor.region : childWhoText(machine, actor);
}

function errorLine(doc: Document, step: VizLiveStep): HTMLElement | null {
  if (step.error === null) return null;
  return html(doc, "p", { class: "explore-warning", role: "alert", "data-live-error": "" }, [
    `Handler threw: ${step.error}`,
  ]);
}

function outputRows(
  doc: Document,
  context: {
    machine: VizMachine;
    step: VizLiveStep;
    taken: ReadonlySet<string>;
    routes: VizOutputRoutes | undefined;
  },
): HTMLElement[] {
  const { machine, step, taken, routes } = context;
  return step.sent.flatMap((output) => {
    const routed = routes?.[machine.id]?.[output] ?? [];
    const found = routed.filter((route) => !taken.has(route.event));
    if (found.length === 0 && (routed.length > 0 || taken.has(output))) return [];
    return [
      html(doc, "p", { "data-live-sent": "" }, [
        `${partName(machine, step.actor)} sent `,
        code(doc, output),
        " out",
        ...found.flatMap((route, at) => [
          at === 0 ? ": " : ", ",
          code(doc, route.to),
          " takes ",
          code(doc, route.event),
        ]),
      ]),
    ];
  });
}

function notRunLine(doc: Document, step: VizLiveStep): HTMLElement {
  return html(doc, "p", { "data-live-not-run": "" }, [
    "Not run here: ",
    ...step.effects.flatMap((name, index) => [index === 0 ? "" : "; ", code(doc, name)]),
  ]);
}

/** "kitchen sent " when a part is known to have sent it; "" is the machine itself. */
function sentBy(machine: VizMachine, step: VizLiveStep): string {
  const sender = step.message?.sender ?? null;
  return sender === null ? "" : `${sender === "" ? machine.id : sender} sent `;
}

function afterLine(
  doc: Document,
  context: { machine: VizMachine; step: VizLiveStep },
): HTMLElement {
  const { machine, step } = context;
  const lost = step.message !== undefined && step.message.dropped !== null;
  const receiver = partName(machine, step.actor);
  const tail = tailText(step, localName);
  const lead = lost ? "! " : "";
  const on = step.message === undefined ? " on its own" : "";
  const from = sentBy(machine, step);
  const body =
    from !== "" || lost
      ? [from, code(doc, step.event), ` to ${receiver}: ${tail}`]
      : [`${receiver} took `, code(doc, step.event), `${on}: ${tail}`];
  return html(
    doc,
    "p",
    {
      "data-live-after": "",
      "data-live-dropped": lost ? "" : null,
    },
    [lead, ...body],
  );
}

function stepItem(
  doc: Document,
  context: {
    machine: VizMachine;
    index: number;
    total: number;
    step: VizStep;
    own: VizLiveStep | null;
    rows: ReadonlyArray<VizLiveStep>;
    held: boolean;
    routes: VizOutputRoutes | undefined;
  },
): HTMLElement {
  const { machine, step, own, rows, routes } = context;
  const newest = context.index === context.total - 1;
  const taken = new Set(rows.filter((entry) => entry.message).map((entry) => entry.event));
  const notRun = newest && context.held;
  const extras = (entry: VizLiveStep) => [
    errorLine(doc, entry),
    ...outputRows(doc, { machine, step: entry, taken, routes }),
    notRun && entry.effects.length > 0 ? notRunLine(doc, entry) : null,
  ];
  const ignored = own?.outcome === "ignored";
  const head = step.kind === "advance" ? null : own;
  return html(
    doc,
    "li",
    {
      "data-step": String(context.index + 1),
      class: newest ? "explore-outcome" : null,
      "data-outcome": newest && own !== null ? own.outcome : null,
    },
    [
      html(doc, "p", { "data-live-outcome": "", "data-live-dropped": ignored ? "" : null }, [
        `${ignored ? "! " : ""}Step ${context.index + 1} of ${context.total}: `,
        ...(head === null
          ? [`time passed ${step.kind === "advance" ? step.ms : 0} ms`]
          : outcomeText(doc, machine, head)),
      ]),
      ...(head === null ? [] : extras(head)),
      ...rows.flatMap((entry) => [afterLine(doc, { machine, step: entry }), ...extras(entry)]),
    ],
  );
}

function runList(
  doc: Document,
  machine: VizMachine,
  live: NonNullable<ExploreContext["live"]>,
): HTMLElement {
  const { state, routes, lasts } = live;
  const total = state.steps.length;
  const held = state.effectMode === "held";
  const items = state.steps.map((step, index) => {
    const own = lasts[index] ?? null;
    const after = index === total - 1 ? state.after : (live.afters?.[index] ?? []);
    // An advance's own entry is the first move its timer caused: it reads as a row.
    const rows = step.kind === "advance" && own !== null ? [own, ...after] : after;
    return stepItem(doc, { machine, index, total, step, own, rows, held, routes });
  });
  // A driver that threw reports an entry that no step of the walk owns.
  return html(doc, "div", { class: "explore-live" }, [
    total === 0
      ? html(doc, "p", { class: "muted", "data-live-empty": "" }, [
          "No steps yet. Click an arrow on the board to send its event. Its ? opens Details, where you can change what it sends.",
        ])
      : html(doc, "ol", { class: "explore-run" }, items),
    state.last !== null && state.last !== lasts[total - 1] ? errorLine(doc, state.last) : null,
  ]);
}

export interface ExploreParts {
  /** Where the walk is and what can happen next; undefined without a driver. */
  step: HTMLElement | undefined;
  /** The live context, read only; without a driver, the declared context fields. Undefined when there is neither. */
  context: HTMLElement | undefined;
}

interface LivePartsOptions {
  machine: VizMachine;
  live: NonNullable<ExploreContext["live"]>;
  final: boolean;
}

/** Live Step tab, below the root's state: regions, held effects, outcome, time. */
function liveParts(doc: Document, options: LivePartsOptions): Array<HTMLElement | null> {
  const { machine, live, final } = options;
  const { state } = live;
  const moves: LiveMoves = { state, picked: live.picked ?? null, pick: live.pick };
  return [
    runList(doc, machine, live),
    ...childrenSections(doc, machine, moves),
    final ? null : timersSection(doc, { state, send: live.send }),
  ];
}

/** The walk, split for the panel's tabs. */
export function explorePanel(doc: Document, context: ExploreContext): ExploreParts {
  const { machine, live } = context;
  if (live === undefined) return { step: undefined, context: contextView(doc, { machine }) };
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
      ...liveParts(doc, { machine, live, final }),
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
  return { step, context: contextView(doc, { machine, live: live.state.context }) };
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
  const sources = new Map(machine.edges.map((edge) => [edge.id, edge.from]));
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    const members = listOf(element.dataset["members"]) ?? [id];
    const here = members.find((member) => currents.includes(sources.get(member) ?? ""));
    element.classList.toggle(
      "next",
      members.some((member) => next.has(member)),
    );
    markBlocked(element, blocked.get(here ?? id));
  }
  markCurrent(root, currents);
}

/** A JSON list written to a `data-` attribute; ids may hold spaces. */
export function listOf(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : (JSON.parse(value) as string[]);
}

/** A node is current when it is a current state, or a shared node standing for one. */
function markCurrent(root: HTMLElement, currents: ReadonlyArray<string>): void {
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-node-id]")) {
    const id = element.dataset["nodeId"] ?? "";
    const states = listOf(element.dataset["states"]) ?? [];
    element.classList.toggle(
      "current",
      [id, ...states].some((state) => currents.includes(state)),
    );
  }
}

const LOCK_WIDTH = 8;
const LOCK_HEIGHT = 10;

/** A blocked arrow: grey lock left of the label's first line, and the reason as its accessible description. */
function markBlocked(element: SVGGElement, reason: string | undefined): void {
  element.classList.toggle("blocked", reason !== undefined);
  element.querySelector(":scope > .blocked-lock")?.remove();
  if (reason === undefined) {
    element.removeAttribute("aria-description");
    return;
  }
  element.setAttribute("aria-description", reason);
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
