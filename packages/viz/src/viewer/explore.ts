import { movesFrom, stateAfter } from "../moves.ts";
import { coveredByAny } from "../schema.ts";
import {
  actorOf,
  actorText,
  localName,
  offeredEvents,
  regionPaths,
  walkedChild,
} from "./compartments.ts";
import type { ExploreStep, Move, MoveGroup } from "../moves.ts";
import type {
  VizActorRef,
  VizField,
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
import { changedKeys, contextLines } from "./context-diff.ts";
import { html, svg } from "./dom.ts";
import { defaultValue, parseValue, valueFields, valueText } from "./fill.ts";
import type { Values } from "./fill.ts";
import type { Selection } from "./graph.ts";
import { CHAR_WIDTH } from "./layout.ts";

export interface ExploreContext {
  machine: VizMachine;
  path: ReadonlyArray<ExploreStep>;
  take: (step: ExploreStep) => void;
  /** Keep the first `length` steps. */
  rewind: (length: number) => void;
  /** Set when a driver runs the actor: the panel shows its outcome and sends steps to it. */
  live?: {
    state: VizLiveState;
    /** Entry i is the driver's `last` for `state.steps[i]`. */
    outcomes: ReadonlyArray<VizLiveStep | null>;
    /** Entry i is what moved after `state.steps[i]`, as the driver reported it then. */
    afters?: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
    /** Where each output of the shown machine goes; unset: only the output names show. */
    routes?: VizOutputRoutes;
    /** The part that sends `event` into `part` ("" = the root); null or unset: it comes from outside. */
    fromPart?: (part: string, event: string) => string | null;
    send: (step: VizStep) => void;
    previous?: VizJson;
    /** The child a count click walks; the Step tab shows that child of each map. */
    picked?: { map: string; key: string } | null;
    /** Replace the walk with these steps from a fresh actor. */
    play: (steps: ReadonlyArray<VizStep>, run?: string) => void;
    /** Send an event at once, with the values set in the Context tab. */
    sendEvent: (event: string, actor?: VizActorRef) => void;
    /** Field name → the value set in the Context tab. */
    values: Values;
    /** Set a field's value; undefined clears it. */
    setValue: (name: string, value: VizJson | undefined) => void;
  };
  /** The closed-by-default "Events and time" fold: its open state lives with the view. */
  events: { open: boolean; onToggle: (open: boolean) => void };
}

/** "parts": inputs another part of the machine sends; sending one by hand skips that part. */
type SendGroup = MoveGroup | "parts";

const GROUP_TITLES: Record<SendGroup, string> = {
  input: "Send an input",
  effect: "Effect reports back",
  internal: "Other internal events",
  parts: "Sent by another part (by hand skips it)",
};

function code(doc: Document, text: string): HTMLElement {
  return html(doc, "code", {}, [text]);
}

function button(
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

function movesSection(
  doc: Document,
  moves: ReadonlyArray<Move>,
  context: {
    current: string;
    final: boolean;
    take: (step: ExploreStep) => void;
  },
): HTMLElement | null {
  if (context.final) return null;
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

/** The path as plain text: the machine, then one numbered line per entry, full text where the button shortens it. */
function pathText(machine: string, list: Element): string {
  const lines = [...list.querySelectorAll("li > button")].map(
    (entry, index) => `${index}. ${entry.getAttribute("title") ?? entry.textContent ?? ""}`,
  );
  return [`${machine} path`, ...lines].join("\n");
}

/** "Copy path": puts the path on the clipboard and says whether it worked. */
function copyPathButton(doc: Document, machine: string, list: Element): HTMLElement {
  const copy = html(doc, "button", { type: "button", "data-copy-path": "" }, ["Copy path"]);
  copy.addEventListener("click", () => {
    const clipboard = doc.defaultView?.navigator.clipboard;
    const done = (text: string) => {
      copy.textContent = text;
    };
    if (clipboard === undefined) return done("Copy failed: select the path instead");
    clipboard.writeText(pathText(machine, list)).then(
      () => done("Copied"),
      () => done("Copy failed: select the path instead"),
    );
  });
  return copy;
}

/** The Path heading with its Copy button, then the list. */
function pathBlock(doc: Document, machine: string, list: HTMLElement): HTMLElement {
  return html(doc, "div", { class: "explore-path" }, [
    html(doc, "div", { class: "explore-path-head" }, [
      html(doc, "h3", {}, ["Path"]),
      copyPathButton(doc, machine, list),
    ]),
    list,
  ]);
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
  return pathBlock(
    doc,
    machine.id,
    html(doc, "ol", {}, [
      html(doc, "li", { "aria-current": path.length === 0 ? "step" : null }, [
        button(doc, [`start in ${machine.initial ?? "?"}`], {
          onClick: () => context.rewind(0),
          attrs: { "data-rewind": "0" },
        }),
      ]),
      ...items,
    ]),
  );
}

/** An object prints `{name value, name value}` (strings raw, other values as JSON); anything else as JSON. */
function payloadText(value: VizJson): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const fields = Object.entries(value).map(
    ([name, each]) => `${name} ${typeof each === "string" ? each : JSON.stringify(each)}`,
  );
  return `{${fields.join(", ")}}`;
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

/** `p1, p2, p3`; cut, more than 3 keys read `p1, p2, p3 and N more`. */
function keyList(keys: ReadonlyArray<string>, cut: boolean): string {
  if (!cut || keys.length <= 3) return keys.join(", ");
  return `${keys.slice(0, 3).join(", ")} and ${keys.length - 3} more`;
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
    html(doc, "div", {}, [
      input,
      " ms ",
      button(doc, ["advance"], {
        onClick: advance,
        attrs: { "data-advance": "" },
      }),
    ]),
    problem,
  ]);
}

interface LiveMoves {
  state: VizLiveState;
  send: (step: VizStep) => void;
  final: boolean;
  picked?: { map: string; key: string } | null;
  sendEvent: (event: string, actor?: VizActorRef) => void;
  fromPart?: (part: string, event: string) => string | null;
}

/** One sendable event: a button that sends it, or opens its payload form. */
function sendItem(
  doc: Document,
  machine: VizMachine,
  context: {
    live: LiveMoves;
    moves: Move[];
    event: string;
    tagged: boolean;
    current: string;
    compartment: string;
    /** Set for an actor map's child; otherwise the region of `compartment`. */
    child?: VizActorRef;
  },
): HTMLElement {
  const { live, moves, event, tagged, current, compartment } = context;
  const actor = context.child ?? actorOf(compartment).actor;
  const move = moves.find((each) => each.edge.event === event);
  return html(doc, "li", { "data-send-item": event }, [
    button(doc, [code(doc, event)], {
      onClick: () => live.sendEvent(event, actor),
      attrs: { "data-send": event },
    }),
    move === undefined
      ? html(doc, "span", { class: "muted", "data-ignored": "" }, [` ignored in ${current}`])
      : null,
    !tagged || move === undefined || move.sentBy.length === 0
      ? null
      : html(doc, "span", { class: "muted", "data-sent-by": move.sentBy.join(",") }, [
          ` from ${move.sentBy.join(", ")}`,
        ]),
    move === undefined ? null : docNote(doc, { text: move.edge.doc, scope: "edge" }),
  ]);
}

type StateEffects = VizMachine["states"][number]["effects"];

interface WaitingEffect {
  /** "" for the machine itself, else the region's path. */
  compartment: string;
  /** The state the effect belongs to: the top-level state or a region's current state. */
  from: string;
  effect: StateEffects[number];
}

/** The held effects of the current state and of each region's current state that still wait for an answer. */
function waitingEffects(machine: VizMachine, state: VizLiveState): WaitingEffect[] {
  if (state.effectMode !== "held") return [];
  const owners = [
    { compartment: "", from: state.state },
    ...regionPaths(state).map((path) => ({ compartment: path, from: state.regions[path] ?? "" })),
  ];
  return owners.flatMap(({ compartment, from }) => {
    const effects = machine.states.find((each) => each.id === from)?.effects ?? [];
    return state.waiting.flatMap((name) =>
      effects
        .filter((effect) => effect.name === name)
        .map((effect) => ({ compartment, from, effect })),
    );
  });
}

/** The Send list of one actor: the machine itself (""), a region (its path) or, with `child`, a map's child. */
function liveMovesSection(
  doc: Document,
  machine: VizMachine,
  live: LiveMoves & { current: string; compartment: string; child?: VizActorRef },
): HTMLElement | null {
  const { current, compartment, child } = live;
  const actor = child === undefined ? actorOf(compartment) : { actor: child };
  if (child !== undefined && live.final) return null;
  const title = compartment === "" ? "h3" : "h4";
  if (live.final && compartment === "") return null;
  const heading =
    compartment === "" || child !== undefined
      ? []
      : [html(doc, "h3", {}, [code(doc, compartment), " handles"])];
  const block = (children: Array<HTMLElement | null>) =>
    html(
      doc,
      "div",
      {
        class: compartment === "" ? "explore-moves" : "explore-moves explore-region-moves",
        "data-actor": actorText(actor.actor),
      },
      [...heading, ...children],
    );
  if (live.final) {
    return block([
      html(doc, "p", { class: "explore-end", "data-region-final": compartment }, [
        code(doc, compartment),
        " is final: it takes no more events.",
      ]),
    ]);
  }
  const moves = movesFrom(machine, current);
  const handled = new Set(moves.map((move) => move.edge.event));
  const events = offeredEvents(machine, compartment, [...handled]);
  const groups: SendGroup[] = ["input", "effect", "internal", "parts"];
  const item = (event: string) =>
    sendItem(doc, machine, {
      live,
      moves,
      event,
      tagged: true,
      current,
      compartment,
      ...(child === undefined ? {} : { child }),
    });
  const groupOf = (event: string): SendGroup => {
    const group = moves.find((each) => each.edge.event === event)?.group ?? "input";
    const sender = live.fromPart?.(compartment, event) ?? null;
    return group === "input" && sender !== null ? "parts" : group;
  };
  return block(
    groups.flatMap((group) => {
      const members = events.filter((event) => groupOf(event) === group);
      return members.length === 0
        ? []
        : [
            html(doc, title, {}, [GROUP_TITLES[group]]),
            html(doc, "ul", { "data-group": group }, members.map(item)),
          ];
    }),
  );
}

/** ", waiting for a, b" for the held effects of one compartment that still wait; nothing when none do. */
function waitingText(
  doc: Document,
  machine: VizMachine,
  context: { state: VizLiveState; compartment: string },
): Array<Node | string> {
  const { state, compartment } = context;
  const waiting = waitingEffects(machine, state).filter(
    (each) => each.compartment === compartment && each.effect.sends?.length !== 0,
  );
  return waiting.flatMap(({ from, effect }, index) => {
    const handled = new Set(movesFrom(machine, from).map((move) => move.edge.event));
    const reports = (effect.sends ?? []).filter((event) => handled.has(event)).join(" ");
    return [
      index === 0 ? ", waiting for " : ", ",
      html(doc, "code", { "data-waiting-on": effect.name, "data-reports": reports }, [effect.name]),
    ];
  });
}

/** One line per region: where it is now. */
function regionLines(doc: Document, machine: VizMachine, state: VizLiveState): HTMLElement[] {
  return regionPaths(state).flatMap((path) => {
    const id = state.regions[path] ?? "";
    const info = machine.states.find((each) => each.id === id);
    return [
      html(
        doc,
        "p",
        { class: "explore-now explore-region-now", "data-region": path, "data-region-state": id },
        [
          code(doc, path),
          ": in ",
          html(doc, "strong", {}, [localName(id)]),
          info?.final ? " (final)" : "",
          ...(info?.final ? [] : waitingText(doc, machine, { state, compartment: path })),
        ],
      ),
      docNote(doc, { text: info?.doc ?? null, scope: "state" }),
    ].filter((node): node is HTMLElement => node !== null);
  });
}

/** One section per actor map: its walked child, where it is now, and what it handles. */
function childrenSections(
  doc: Document,
  machine: VizMachine,
  live: LiveMoves,
): Array<HTMLElement | null> {
  const { state } = live;
  return machine.maps.map((map) => {
    const walked = walkedChild(state, map, live.picked ?? null);
    const rows = (walked === undefined ? [] : [walked]).map((child) => {
      const info = machine.states.find((each) => each.id === child.state);
      const final = info?.final === true;
      const moves = liveMovesSection(doc, machine, {
        ...live,
        current: child.state,
        compartment: map,
        final,
        child: { map, key: child.key },
      });
      return html(
        doc,
        "li",
        {
          class: "explore-child",
          "data-child-map": map,
          "data-child-key": child.key,
          "data-child-state": child.state,
        },
        [
          html(doc, "p", { class: "explore-now explore-child-now" }, [
            code(doc, child.key),
            ": in ",
            html(doc, "strong", {}, [localName(child.state)]),
            final ? " (final)" : "",
          ]),
          moves,
        ],
      );
    });
    if (rows.length === 0) return null;
    return html(doc, "section", { class: "explore-map", "data-map": map }, [
      html(doc, "ul", { class: "explore-children" }, rows),
    ]);
  });
}

/** The root's Send list, then one per region. The root's "Done." does not stop the regions. */
function liveBlocks(
  doc: Document,
  machine: VizMachine,
  live: LiveMoves,
): Array<HTMLElement | null> {
  const finalOf = (id: string) => machine.states.find((each) => each.id === id)?.final === true;
  return [
    liveMovesSection(doc, machine, { ...live, current: live.state.state, compartment: "" }),
    ...regionPaths(live.state).map((path) => {
      const current = live.state.regions[path] ?? "";
      return liveMovesSection(doc, machine, {
        ...live,
        current,
        compartment: path,
        final: finalOf(current),
      });
    }),
  ];
}

function runsSection(
  doc: Document,
  machine: VizMachine,
  live: { play: (steps: ReadonlyArray<VizStep>, run?: string) => void },
): HTMLElement | null {
  if (machine.runs.length === 0) return null;
  return html(doc, "div", { class: "explore-runs", "data-runs": "" }, [
    html(doc, "h3", {}, ["Runs"]),
    html(
      doc,
      "ul",
      {},
      machine.runs.map((run) =>
        html(doc, "li", {}, [
          button(doc, [run.name], {
            onClick: () => live.play(run.steps, run.name),
            attrs: { "data-run": run.name },
          }),
        ]),
      ),
    ),
  ]);
}

function fieldValue(value: VizJson, name: string): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "not set";
  return Object.hasOwn(value, name) ? (JSON.stringify(value[name]) ?? "not set") : "not set";
}

/** One row per declared context field: meaning and value now, changed ones marked. */
function fieldsTable(
  doc: Document,
  context: {
    fields: ReadonlyArray<VizField>;
    value: VizJson;
    previous: VizJson | undefined;
  },
): HTMLElement {
  const { fields, value, previous } = context;
  const head = ["Field", "Type", "Meaning", "Now"];
  return html(doc, "table", { "data-context-fields": "" }, [
    html(doc, "thead", {}, [
      html(
        doc,
        "tr",
        {},
        head.map((name) => html(doc, "th", {}, [name])),
      ),
    ]),
    html(
      doc,
      "tbody",
      {},
      fields.map((field) => {
        const now = fieldValue(value, field.name);
        const changed = previous !== undefined && now !== fieldValue(previous, field.name);
        return html(
          doc,
          "tr",
          {
            "data-context-field": field.name,
            "data-context-changed": changed ? "" : null,
          },
          [
            html(doc, "td", {}, [code(doc, field.name)]),
            html(doc, "td", {}, [code(doc, field.type)]),
            html(doc, "td", {}, [field.doc ?? ""]),
            html(doc, "td", {}, [
              changed ? html(doc, "mark", { class: "context-changed" }, [now]) : now,
            ]),
          ],
        );
      }),
    ),
  ]);
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
  return html(doc, "div", { class: "explore-values", "data-values": "" }, [
    html(doc, "h3", {}, ["Values events send"]),
    ...rows,
  ]);
}

/** The values events send, then the declared fields as a table, or the pretty-printed context with changed lines marked. */
function contextSection(
  doc: Document,
  context: {
    machine: VizMachine;
    value: VizJson;
    previous: VizJson | undefined;
    live: NonNullable<ExploreContext["live"]>;
  },
): HTMLElement {
  const { machine, value, previous } = context;
  const body =
    machine.context !== null
      ? fieldsTable(doc, { fields: machine.context, value, previous })
      : prettyContext(doc, value, previous);
  return html(doc, "div", { class: "explore-context" }, [
    valuesList(doc, context),
    html(doc, "div", { "data-live-context": "" }, [body]),
  ]);
}

function prettyContext(doc: Document, value: VizJson, previous: VizJson | undefined): HTMLElement {
  return html(
    doc,
    "pre",
    {},
    contextLines(value, previous).flatMap((line, index) => [
      index === 0 ? "" : "\n",
      line.changed
        ? html(doc, "mark", { class: "context-changed", "data-context-changed": "" }, [line.text])
        : line.text,
    ]),
  );
}

/** How many context lines the last live step changed. */
export function changedLines(state: VizLiveState, previous: VizJson | undefined): number {
  return contextLines(state.context, previous).filter((line) => line.changed).length;
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

function outcomeText(doc: Document, machine: VizMachine, step: VizLiveStep): Array<Node | string> {
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

/** The last step left everything as it was: no move, same context, nothing sent, nothing after it, no child started or removed. */
function noChange(
  step: VizLiveStep,
  at: { before: VizJson | undefined; state: VizLiveState },
): boolean {
  const { before, state } = at;
  const stayed =
    step.outcome === "stay" || (step.outcome === "transition" && step.from === step.to);
  if (!stayed || before === undefined || step.sent.length > 0) return false;
  if (state.after.length > 0) return false;
  const n = state.steps.length;
  if (startedAt(state, n).length > 0 || removedAt(state, n).length > 0) return false;
  return JSON.stringify(before) === JSON.stringify(step.context);
}

function stepLines(
  doc: Document,
  context: {
    machine: VizMachine;
    step: VizLiveStep;
    before: VizJson | undefined;
    held: boolean;
    routes: VizOutputRoutes | undefined;
  },
): Array<HTMLElement | null> {
  const { machine, step, before } = context;
  const because = becauseOf(machine, step);
  const changed = changedKeys(before, step.context);
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
    changed.length === 0
      ? null
      : html(doc, "p", { "data-live-changed": "" }, [`Changed: ${changed.join(", ")}`]),
    sentLine(doc, { machine, step, routes: context.routes }),
    step.effects.length > 0 && context.held ? notRunLine(doc, { machine, step }) : null,
    step.effects.length === 0 || context.held
      ? null
      : html(doc, "p", { "data-live-effects": "" }, [
          "Effects started: ",
          ...step.effects.flatMap((name, index) => [index === 0 ? "" : ", ", code(doc, name)]),
        ]),
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
    previous: VizJson | undefined;
    routes: VizOutputRoutes | undefined;
  },
): HTMLElement {
  const { machine, state, previous, routes } = live;
  const { last, after } = state;
  const held = state.effectMode === "held";
  return html(doc, "div", { class: "explore-live" }, [
    last === null
      ? null
      : html(doc, "div", { class: "explore-outcome", "data-outcome": last.outcome }, [
          ...stepLines(doc, { machine, step: last, before: previous, held, routes }),
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
          noChange(last, { before: previous, state })
            ? html(doc, "p", { class: "muted", "data-live-no-change": "" }, [
                "Nothing changed: the handler kept the state and context, and sent nothing.",
              ])
            : null,
          ...after.map((step, index) =>
            html(doc, "div", { "data-live-after": "" }, [
              afterLine(doc, { machine, step, last }),
              ...stepLines(doc, {
                machine,
                step,
                before: (index === 0 ? last : after[index - 1])?.context,
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

/** `: p1 sendingPhoto → photoSent` and its kin for a step sent to a map child; "" for any other step. */
function childMove(
  machine: VizMachine,
  step: VizStep,
  outcome: VizLiveStep | null | undefined,
): string {
  const actor = step.kind === "event" ? step.actor : undefined;
  if (actor === undefined || !("map" in actor) || outcome === undefined || outcome === null)
    return "";
  const who = childWhoText(machine, actor);
  if (outcome.outcome === "transition") {
    return `: ${who} ${localName(outcome.from)} → ${localName(outcome.to)}`;
  }
  if (outcome.outcome === "stay") return `: ${who} stays in ${localName(outcome.from)}`;
  return `: ${who}, nothing ran`;
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
export function isDropped(step: VizLiveStep): boolean {
  return step.message !== undefined && step.message.dropped !== null;
}

/** "waiter has no handler for DISH_READY in onBreak": why a part dropped a message. */
export function dropReasonText(machine: VizMachine, step: VizLiveStep): string {
  return `${partName(machine, step.actor)} has no handler for ${step.event} in ${localName(step.from)}`;
}

/** The sender as the row names it ("" is the machine itself); null when no part is known to have sent it. */
function senderName(machine: VizMachine, step: VizLiveStep): string | null {
  const sender = step.message?.sender ?? null;
  return sender === "" ? machine.id : sender;
}

/** `orders → ` before a part's name when the step says who sent it; "" otherwise. */
function fromSender(machine: VizMachine, step: VizLiveStep): string {
  const sender = senderName(machine, step);
  return sender === null ? "" : `${sender} → `;
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

/** `, then orders → w1: free → working; kitchen → waiter DISH_READY dropped`: what the other parts did after the step; "" when nothing. */
function thenMoves(machine: VizMachine, later: ReadonlyArray<VizLiveStep>): string {
  const dropped = later
    .filter(isDropped)
    .map(
      (each) =>
        `${fromSender(machine, each)}${partName(machine, each.actor)} ${each.event} dropped`,
    );
  const moved = later
    .filter((each) => each.outcome === "transition")
    .map(
      (each) =>
        `${fromSender(machine, each)}${partName(machine, each.actor)}: ${localName(each.from)} → ${localName(each.to)}`,
    );
  const items = [...dropped, ...moved];
  if (items.length === 0) return "";
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
  return `, then ${items.slice(0, 3).join("; ")}${more}`;
}

/** The Path entry for step `index`: what was sent, what the child did, which children it started or removed. */
function pathEntry(
  machine: VizMachine,
  at: {
    live: {
      state: VizLiveState;
      outcomes: ReadonlyArray<VizLiveStep | null>;
      afters?: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
    };
    index: number;
  },
): { text: string; title: string | null; cascade: boolean } {
  const { index } = at;
  const { state, outcomes, afters } = at.live;
  const step = state.steps[index];
  if (step === undefined) return { text: "", title: null, cascade: false };
  const head =
    step.kind === "advance"
      ? `advance ${step.ms} ms`
      : step.payload === null
        ? step.event
        : `${step.event} ${payloadText(step.payload)}`;
  const later = index === state.steps.length - 1 ? state.after : (afters?.[index] ?? []);
  const move = childMove(machine, step, outcomes[index]) + thenMoves(machine, later);
  const started = startedAt(state, index + 1).map((child) => child.key);
  const removed = removedAt(state, index + 1).map((child) => child.key);
  const suffix = (cut: boolean) => {
    const parts = [
      started.length === 0 ? null : `${keyList(started, cut)} started`,
      removed.length === 0 ? null : `${keyList(removed, cut)} removed`,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? "" : ` → ${parts.join("; ")}`;
  };
  const mark = later.some(isDropped) ? "! " : "";
  const text = mark + head + move + suffix(true);
  const full = mark + head + move + suffix(false);
  return {
    text,
    title: full === text ? null : full,
    cascade: later.some((each) => each.outcome === "transition"),
  };
}

function pathButton(
  doc: Document,
  at: { context: ExploreContext; live: NonNullable<ExploreContext["live"]>; index: number },
): HTMLElement {
  const { context, live, index } = at;
  const { text, title, cascade } = pathEntry(context.machine, { live, index });
  return button(doc, [text], {
    onClick: () => context.rewind(index + 1),
    attrs: {
      "data-rewind": String(index + 1),
      ...(title === null ? {} : { title }),
      ...(cascade ? { "data-live-cascade": "" } : {}),
    },
  });
}

function livePathSection(
  doc: Document,
  context: ExploreContext,
  live: NonNullable<ExploreContext["live"]>,
): HTMLElement {
  const { state } = live;
  return pathBlock(
    doc,
    context.machine.id,
    html(doc, "ol", {}, [
      html(doc, "li", { "aria-current": state.steps.length === 0 ? "step" : null }, [
        button(doc, ["start"], {
          onClick: () => context.rewind(0),
          attrs: { "data-rewind": "0" },
        }),
      ]),
      ...state.steps.map((_, index) =>
        html(doc, "li", { "aria-current": index === state.steps.length - 1 ? "step" : null }, [
          pathButton(doc, { context, live, index }),
        ]),
      ),
    ]),
  );
}

function nowSection(
  doc: Document,
  machine: VizMachine,
  context: { current: string; final: boolean; state?: VizLiveState },
): Array<HTMLElement | null> {
  const { current, final, state } = context;
  return [
    html(doc, "p", { class: "explore-now" }, [
      "In ",
      html(doc, "strong", {}, [current]),
      final ? " (final)" : "",
      ...(state === undefined || final
        ? []
        : waitingText(doc, machine, { state, compartment: "" })),
    ]),
    docNote(doc, {
      text: machine.states.find((state) => state.id === current)?.doc ?? null,
      scope: "state",
    }),
  ];
}

export interface ExploreParts {
  /** Where the walk is and what can happen next. */
  step: HTMLElement;
  /** Live only: the actor's context. */
  context: HTMLElement | null;
  /** Runs and the steps taken so far. */
  path: HTMLElement;
}

/** The closed "Events and time" fold; null when nothing would be inside. */
function eventsFold(
  doc: Document,
  context: { events: ExploreContext["events"]; children: Array<HTMLElement | null> },
): HTMLElement | null {
  const children = context.children.filter((child): child is HTMLElement => child !== null);
  if (children.length === 0) return null;
  const details = html(
    doc,
    "details",
    { class: "explore-events", "data-events": "", open: context.events.open ? "" : null },
    [html(doc, "summary", {}, ["Events and time"]), ...children],
  );
  details.addEventListener("toggle", () => context.events.onToggle(details.open));
  return details;
}

/** Live Step tab, below the root's state: regions, held effects, outcome, Send lists, time. */
function liveParts(
  doc: Document,
  machine: VizMachine,
  context: {
    live: NonNullable<ExploreContext["live"]>;
    current: string;
    final: boolean;
    events: ExploreContext["events"];
  },
): Array<HTMLElement | null> {
  const { live, final, events } = context;
  const { state } = live;
  const moves: LiveMoves = {
    state,
    send: live.send,
    final,
    picked: live.picked ?? null,
    sendEvent: live.sendEvent,
    ...(live.fromPart === undefined ? {} : { fromPart: live.fromPart }),
  };
  return [
    ...regionLines(doc, machine, state),
    liveResultSection(doc, {
      machine,
      state,
      previous: live.previous,
      routes: live.routes,
    }),
    eventsFold(doc, {
      events,
      children: [
        ...liveBlocks(doc, machine, moves),
        ...childrenSections(doc, machine, moves),
        final ? null : timersSection(doc, { state, send: live.send }),
      ],
    }),
  ];
}

/** The walk, split for the panel's tabs. */
export function explorePanel(doc: Document, context: ExploreContext): ExploreParts {
  const { machine, path, live, events } = context;
  const current = live?.state.state ?? stateAfter(machine, path) ?? "";
  const final = machine.states.find((state) => state.id === current)?.final === true;
  const length = live?.state.steps.length ?? path.length;
  const step = html(
    doc,
    "section",
    {
      class: "explore",
      "data-current": current,
      ...(live ? { "data-live-note": "", "data-effect-mode": live.state.effectMode } : {}),
      "data-done": final ? "" : null,
    },
    [
      ...nowSection(doc, machine, { current, final, ...(live ? { state: live.state } : {}) }),
      ...(live
        ? liveParts(doc, machine, { live, current, final, events })
        : [
            eventsFold(doc, {
              events,
              children: [
                movesSection(doc, movesFrom(machine, current), {
                  current,
                  final,
                  take: context.take,
                }),
              ],
            }),
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
    ],
  );
  return {
    step,
    context: live
      ? contextSection(doc, {
          machine,
          value: live.state.context,
          previous: live.previous,
          live,
        })
      : null,
    path: historySection(doc, context),
  };
}

function historySection(doc: Document, context: ExploreContext): HTMLElement {
  const { live } = context;
  return html(
    doc,
    "div",
    { class: "explore-history" },
    live
      ? [runsSection(doc, context.machine, live), livePathSection(doc, context, live)]
      : [pathSection(doc, context)],
  );
}

/**
 * Where a click on the diagram moves the walk, or null to just show details:
 * a next-step edge with one target, or a state exactly one next step reaches.
 */
export function clickStep(
  machine: VizMachine,
  context: { path: ReadonlyArray<ExploreStep>; selection: Selection; currents?: string[] },
): ExploreStep | null {
  const currents = [...new Set(currentsIn(machine, context))];
  const { selection } = context;
  const steps = currents.flatMap((current) =>
    movesFrom(machine, current).flatMap((move) =>
      move.targets.map((to) => ({ edge: move.edge.id, to, current })),
    ),
  );
  const matching =
    selection.kind === "edge"
      ? steps.filter((step) => step.edge === selection.id)
      : steps.filter((step) => step.to === selection.id && step.to !== step.current);
  const only = matching[0];
  return matching.length === 1 && only !== undefined ? { edge: only.edge, to: only.to } : null;
}

/** Every state the actor is in now: live, the machine's and each region's; walking, where the path ends. */
function currentsIn(
  machine: VizMachine,
  context: { path: ReadonlyArray<ExploreStep>; currents?: string[] },
): string[] {
  if (context.currents !== undefined) return context.currents;
  const walked = stateAfter(machine, context.path);
  return walked === null ? [] : [walked];
}

/** Mark the walk on the drawn graph: current state, path taken, possible next steps. */
export function markExplore(
  root: HTMLElement,
  context: {
    machine: VizMachine;
    path: ReadonlyArray<ExploreStep>;
    currents?: string[];
    /** Edge id → why its guard blocks it; these are not next steps and reach nothing. */
    blocked?: ReadonlyMap<string, string>;
  },
): void {
  const { machine, path } = context;
  const blocked = context.blocked ?? new Map<string, string>();
  const currents = currentsIn(machine, context);
  const moves = currents.flatMap((current) => movesFrom(machine, current));
  const open = moves.filter((move) => !blocked.has(move.edge.id));
  const next = new Set(open.filter((move) => move.targets.length > 0).map((move) => move.edge.id));
  const reachable = new Set(
    open.flatMap((move) => move.targets).filter((to) => !currents.includes(to)),
  );
  const taken = new Set(path.map((step) => step.edge));
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    element.classList.toggle("taken", taken.has(id));
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

/** A blocked arrow: grey lock left of the label's first line, and `aria-disabled`; the reason is in the note a click opens. */
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
  const left =
    Number(text.getAttribute("x")) -
    ((first.textContent ?? "").length * CHAR_WIDTH) / 2 -
    LOCK_WIDTH -
    4;
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
