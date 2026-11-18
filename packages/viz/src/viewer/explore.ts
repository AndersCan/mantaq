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
    /** Entry i is the step's own entry (`live.last`) when it was taken. */
    lasts?: ReadonlyArray<VizLiveStep>;
    /** Where each output of the shown machine goes; unset: only the output names show. */
    routes?: VizOutputRoutes;
    send: (step: VizStep) => void;
    /** The followed child; its row in the Step tab is marked. */
    picked?: { map: string; key: string } | null;
    /** Follow this child: Send in the map goes to it. */
    pick: (child: { map: string; key: string }) => void;
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

/** One text box per field name the machine's events carry; each box starts at the default. */
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
    const fallback = defaultValue(field, {
      live: live.state,
      afters: live.afters ?? [],
      events: machine.events
        .filter((event) => event.payload?.some((each) => each.name === field.name))
        .map((event) => event.id),
    });
    const fallbackText = fallback === undefined ? "" : valueText(field, fallback);
    const input = html(doc, "input", {
      type: "text",
      "data-value": field.name,
      "aria-label": field.name,
    });
    input.value = set === undefined ? fallbackText : valueText(field, set);
    input.addEventListener("change", () => {
      const value = parseValue(field, input.value);
      if (value === undefined) input.value = fallbackText;
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
  const names = (id: string) => (region === undefined ? id : localName(id));
  const who = step.actor === undefined ? "" : ` to ${partName(machine, step.actor)}`;
  return [code(doc, step.event), `${who}: `, tailText(step, names)];
}

/** Where the part went, or that nobody took the event. */
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

/** Outputs the machine sent out that no message row of the same step carries. */
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
    const found = (routes?.[machine.id]?.[output] ?? []).filter((route) => !taken.has(route.event));
    const routed = (routes?.[machine.id]?.[output] ?? []).length > 0;
    if (routed && found.length === 0) return [];
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

/** A part's move after the step's own: a numbered message from a sender, or a part acting on its own. */
function afterLine(
  doc: Document,
  context: { machine: VizMachine; step: VizLiveStep; number: number | null },
): HTMLElement {
  const { machine, step, number } = context;
  const lost = step.message !== undefined && step.message.dropped !== null;
  const sent = step.message?.sender ?? null;
  const sender = sent === "" ? machine.id : sent;
  const receiver = partName(machine, step.actor);
  const names = localName;
  const tail = tailText(step, names);
  const lead = number === null ? "" : `${lost ? "! " : ""}${number}. `;
  const body =
    sender !== null
      ? [`${sender} sent `, code(doc, step.event), ` to ${receiver}: ${tail}`]
      : lost
        ? [code(doc, step.event), ` to ${receiver}: ${tail}`]
        : [
            `${receiver} took `,
            code(doc, step.event),
            number === null ? " on its own" : "",
            `: ${tail}`,
          ];
  return html(
    doc,
    "p",
    {
      "data-live-after": "",
      "data-message": number === null ? null : String(number),
      "data-live-dropped": lost ? "" : null,
    },
    [lead, ...body],
  );
}

/** One step of the walk: its head, then what each part did because of it. */
function stepItem(
  doc: Document,
  context: {
    machine: VizMachine;
    index: number;
    total: number;
    step: VizStep;
    own: VizLiveStep;
    after: ReadonlyArray<VizLiveStep>;
    firstMessage: number;
    held: boolean;
    routes: VizOutputRoutes | undefined;
  },
): HTMLElement {
  const { machine, step, own, routes } = context;
  const newest = context.index === context.total - 1;
  // An advance's own entry is the first move its timer caused: it reads as a row.
  const rows = step.kind === "advance" ? [own, ...context.after] : context.after;
  const taken = new Set(
    rows.flatMap((entry) => (entry.message === undefined ? [] : [entry.event])),
  );
  const extras = (entry: VizLiveStep) => [
    errorLine(doc, entry),
    ...outputRows(doc, { machine, step: entry, taken, routes }),
    newest && context.held && entry.effects.length > 0
      ? notRunLine(doc, { machine, step: entry })
      : null,
  ];
  let next = context.firstMessage;
  return html(
    doc,
    "li",
    {
      "data-step": String(context.index + 1),
      class: newest ? "explore-outcome" : null,
      "data-outcome": newest ? own.outcome : null,
    },
    [
      html(doc, "p", { "data-live-outcome": "" }, [
        `Step ${context.index + 1} of ${context.total}: `,
        ...(step.kind === "advance"
          ? [`time passed ${step.ms} ms`]
          : outcomeText(doc, machine, own)),
      ]),
      ...(step.kind === "advance" ? [] : extras(own)),
      ...rows.flatMap((entry) => [
        afterLine(doc, {
          machine,
          step: entry,
          number: entry.message === undefined ? null : next++,
        }),
        ...extras(entry),
      ]),
    ],
  );
}

/** Every step of the walk, oldest first; messages are numbered over the whole walk. */
function liveResultSection(
  doc: Document,
  live: {
    machine: VizMachine;
    state: VizLiveState;
    lasts: ReadonlyArray<VizLiveStep> | undefined;
    afters: ReadonlyArray<ReadonlyArray<VizLiveStep>> | undefined;
    routes: VizOutputRoutes | undefined;
  },
): HTMLElement {
  const { machine, state, routes } = live;
  const total = state.steps.length;
  const held = state.effectMode === "held";
  let messages = 1;
  const items = state.steps.map((step, index) => {
    const own = index === total - 1 ? state.last : (live.lasts?.[index] ?? null);
    if (own === null) return null;
    const after = index === total - 1 ? state.after : (live.afters?.[index] ?? []);
    const item = stepItem(doc, {
      machine,
      index,
      total,
      step,
      own,
      after,
      firstMessage: messages,
      held,
      routes,
    });
    messages += [...(step.kind === "advance" ? [own] : []), ...after].filter(
      (entry) => entry.message !== undefined,
    ).length;
    return item;
  });
  // A driver that threw reports an entry that no step of the walk owns.
  const orphan = state.last !== null && state.last !== live.lasts?.[total - 1] ? state.last : null;
  return html(doc, "div", { class: "explore-live" }, [
    total === 0
      ? html(doc, "p", { class: "muted", "data-live-empty": "" }, [
          "No steps yet. Click an arrow on the board to send an event.",
        ])
      : html(doc, "ol", { class: "explore-run" }, items),
    orphan === null ? null : errorLine(doc, orphan),
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
    final: boolean;
  },
): Array<HTMLElement | null> {
  const { live, final } = context;
  const { state } = live;
  const moves: LiveMoves = { state, picked: live.picked ?? null, pick: live.pick };
  return [
    liveResultSection(doc, {
      machine,
      state,
      lasts: live.lasts,
      afters: live.afters,
      routes: live.routes,
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
      ...liveParts(doc, machine, { live, final }),
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
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    element.classList.toggle("next", next.has(id));
    markBlocked(element, blocked.get(id));
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-node-id]")) {
    const id = element.dataset["nodeId"];
    element.classList.toggle("current", id !== undefined && currents.includes(id));
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
