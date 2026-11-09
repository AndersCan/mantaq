import { asksForPayload, movesFrom, stateAfter } from "../moves.ts";
import { coveredByAny } from "../schema.ts";
import { actorOf, actorText, localName, offeredEvents, regionPaths } from "./compartments.ts";
import type { ExploreStep, Move, MoveGroup } from "../moves.ts";
import type {
  VizActorRef,
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizLiveTimer,
  VizMachine,
  VizOutputRoutes,
  VizStep,
} from "../schema.ts";
import { changedKeys, contextLines } from "./context-diff.ts";
import { html } from "./dom.ts";
import { fillChoices, knownPayload } from "./fill.ts";
import type { FillChoice } from "./fill.ts";
import type { Selection } from "./graph.ts";

export interface ExploreContext {
  machine: VizMachine;
  path: ReadonlyArray<ExploreStep>;
  take: (step: ExploreStep) => void;
  /** Keep the first `length` steps. */
  rewind: (length: number) => void;
  /** Set when a driver runs the actor: the panel shows its outcome and sends steps to it. */
  live?: {
    state: VizLiveState;
    /** Where each output of the shown machine goes; unset: only the output names show. */
    routes?: VizOutputRoutes;
    send: (step: VizStep) => void;
    previous?: VizJson;
    /** Replace the walk with these steps from a fresh actor. */
    play: (steps: ReadonlyArray<VizStep>, run?: string) => void;
    /** Open the payload form for an event, or close it with null. */
    compose: (event: string | null, actor?: VizActorRef) => void;
  };
  /** The closed-by-default "Events and time" fold: its open state lives with the view. */
  events: { open: boolean; onToggle: (open: boolean) => void };
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
  compose: (event: string | null, actor?: VizActorRef) => void;
}

/** One control per declared payload field: read its text, write a text into it, focus it. */
interface FieldControl {
  node: HTMLElement;
  read: () => string;
  write: (text: string) => void;
  focus: () => void;
}

/** A choice field with this many options or fewer is a row of buttons. */
const segmentLimit = 4;

/** One control per declared payload field, started at the field's sample. */
function fieldControl(doc: Document, field: VizField): FieldControl {
  const attrs = { "data-field": field.name, "aria-label": field.name };
  if (field.input === "choice") {
    const options = [
      ...(field.optional ? [{ text: "(not set)", value: "" }] : []),
      ...field.choices.map((choice) => ({
        text: typeof choice === "string" ? choice : JSON.stringify(choice),
        value: JSON.stringify(choice),
      })),
    ];
    const start = field.optional ? "" : JSON.stringify(field.sample);
    return options.length <= segmentLimit
      ? choiceButtons(doc, { name: field.name, options, start })
      : choiceSelect(doc, { attrs, options, start });
  }
  const input = html(doc, "input", {
    ...attrs,
    type: field.input === "number" ? "number" : "text",
  });
  if (!field.optional) {
    input.value =
      field.input === "json" || typeof field.sample !== "string"
        ? (JSON.stringify(field.sample) ?? "")
        : field.sample;
  }
  return {
    node: input,
    read: () => input.value,
    write: (text) => {
      input.value = text;
    },
    focus: () => input.focus({ preventScroll: true }),
  };
}

interface ChoiceOption {
  text: string;
  value: string;
}

function choiceSelect(
  doc: Document,
  context: { attrs: Record<string, string>; options: ChoiceOption[]; start: string },
): FieldControl {
  const select = html(doc, "select", context.attrs);
  for (const option of context.options) {
    select.append(html(doc, "option", { value: option.value }, [option.text]));
  }
  select.value = context.start;
  return {
    node: select,
    read: () => select.value,
    write: (text) => {
      select.value = text;
    },
    focus: () => select.focus({ preventScroll: true }),
  };
}

function choiceButtons(
  doc: Document,
  context: { name: string; options: ChoiceOption[]; start: string },
): FieldControl {
  const row = html(doc, "div", {
    class: "segmented",
    role: "group",
    "aria-label": context.name,
    "data-field": context.name,
  });
  const buttons = context.options.map((option) =>
    button(doc, [option.text], {
      attrs: { "data-choice": option.value, "aria-pressed": "false" },
      onClick: () => write(option.value),
    }),
  );
  const write = (text: string) => {
    for (const each of buttons) {
      each.setAttribute("aria-pressed", String(each.getAttribute("data-choice") === text));
    }
  };
  row.append(...buttons);
  write(context.start);
  return {
    node: row,
    read: () =>
      buttons
        .find((each) => each.getAttribute("aria-pressed") === "true")
        ?.getAttribute("data-choice") ?? "",
    write,
    focus: () => buttons[0]?.focus({ preventScroll: true }),
  };
}

/** The value one field's input holds, or undefined to leave the field out; bad json is an error. */
function readField(
  field: VizField,
  value: string,
): { value: VizJson | undefined } | { bad: true } | { missing: true } {
  if (field.input === "text") {
    return { value: value !== "" || !field.optional ? value : undefined };
  }
  if (field.input === "number") {
    const number = Number(value);
    if (value.trim() !== "" && Number.isFinite(number)) return { value: number };
    return field.optional ? { value: undefined } : { missing: true };
  }
  if (value.trim() === "") {
    return field.optional ? { value: undefined } : { missing: true };
  }
  try {
    return { value: JSON.parse(value) as VizJson };
  } catch {
    return { bad: true };
  }
}

/** The payload typed into the field controls, or the name of a json field that did not parse. */
function readFields(
  fields: ReadonlyArray<VizField>,
  controls: ReadonlyMap<string, FieldControl>,
): { payload: Record<string, VizJson> } | { bad: string } | { missing: string } {
  const payload: Record<string, VizJson> = {};
  for (const field of fields) {
    const read = readField(field, controls.get(field.name)?.read() ?? "");
    if ("bad" in read) return { bad: field.name };
    if ("missing" in read) return { missing: field.name };
    if (read.value !== undefined) payload[field.name] = read.value;
  }
  return { payload };
}

function filledText(field: VizField, value: VizJson): string {
  if (field.input === "text" && typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

/** Whether every control holds what pressing the choice would put there: its value, else the field's reset value. */
function choiceHolds(
  doc: Document,
  context: {
    choice: FillChoice;
    fields: ReadonlyArray<VizField>;
    controls: ReadonlyMap<string, FieldControl>;
  },
): boolean {
  const { choice, fields, controls } = context;
  return fields.every((field) => {
    const given = choice.values.find((each) => each.field === field.name);
    const wanted =
      given === undefined ? fieldControl(doc, field).read() : filledText(field, given.value);
    return controls.get(field.name)?.read() === wanted;
  });
}

/** "Values from": a row of buttons that fill the controls from what this walk sent, a fuzzed payload, the type's examples or the context. */
function fillRow(
  doc: Document,
  context: {
    fields: ReadonlyArray<VizField>;
    controls: ReadonlyMap<string, FieldControl>;
    choices: ReadonlyArray<FillChoice>;
  },
): { node: HTMLElement; sync: () => void } {
  const { fields, controls, choices } = context;
  const row = html(doc, "div", {
    class: "segmented",
    role: "group",
    "aria-label": "Values from",
  });
  const buttons = choices.map((choice) =>
    button(doc, [choice.label], {
      attrs: {
        "data-fill-from": choice.label,
        "aria-pressed": "false",
        ...(choice.title === null ? {} : { title: choice.title }),
      },
      onClick: () => {
        for (const field of fields) {
          controls.get(field.name)?.write(fieldControl(doc, field).read());
        }
        for (const { field: name, value } of choice.values) {
          const field = fields.find((each) => each.name === name);
          if (field !== undefined) controls.get(name)?.write(filledText(field, value));
        }
        press(choice);
      },
    }),
  );
  const press = (pressed: FillChoice | undefined) => {
    choices.forEach((choice, index) => {
      buttons[index]?.setAttribute("aria-pressed", String(choice === pressed));
    });
  };
  row.append(...buttons);
  return {
    node: row,
    sync: () => press(choices.find((choice) => choiceHolds(doc, { choice, fields, controls }))),
  };
}

function fieldRow(doc: Document, field: VizField, control: FieldControl | null): HTMLElement {
  const grouped = control?.node.tagName === "DIV";
  return html(doc, grouped ? "div" : "label", { class: "explore-field" }, [
    html(doc, "span", {}, [
      html(doc, "strong", {}, [field.name]),
      " ",
      html(doc, "span", { class: "muted" }, [field.type]),
    ]),
    field.doc === null ? null : html(doc, "span", { class: "muted" }, [field.doc]),
    control?.node ?? null,
  ]);
}

function isRecord(value: unknown): value is Record<string, VizJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a payload form fills from: the machine now, and the steps of the walk. */
type FillLive = Pick<VizLiveState, "state" | "payload" | "context"> & {
  steps?: ReadonlyArray<VizStep>;
};

function fieldsForm(
  doc: Document,
  context: {
    event: string;
    fields: ReadonlyArray<VizField>;
    samples: ReadonlyArray<VizJson>;
    live: FillLive | null;
    send: (step: VizStep) => void;
    close: () => void;
  },
): HTMLElement {
  const { event, fields, samples } = context;
  const steps = context.live?.steps ?? [];
  const controls = new Map(fields.map((field) => [field.name, fieldControl(doc, field)] as const));
  const known = knownPayload(fields, { event, samples, steps });
  const startAt = known !== undefined && isRecord(known.payload) ? known.payload : {};
  for (const field of fields) {
    const value = startAt[field.name];
    if (value !== undefined) controls.get(field.name)?.write(filledText(field, value));
  }
  const choices = fillChoices(fields, { live: context.live, samples, steps });
  const fill = choices.length === 0 ? null : fillRow(doc, { fields, controls, choices });
  fill?.sync();
  const problem = html(doc, "p", {
    class: "explore-warning",
    role: "alert",
    hidden: "",
  });
  const warn = (text: string, focus: FieldControl | undefined) => {
    problem.textContent = text;
    problem.removeAttribute("hidden");
    focus?.focus();
  };
  const fieldLabels = fields.map((field) => fieldRow(doc, field, controls.get(field.name) ?? null));
  const form = html(doc, "div", {
    class: "explore-payload",
    "data-payload-form": event,
  });
  const submit = () => {
    const read = readFields(fields, controls);
    if ("bad" in read) {
      warn(`Not sent: ${read.bad} is not valid JSON.`, controls.get(read.bad));
      return;
    }
    if ("missing" in read) {
      warn(`Not sent: ${read.missing} is required.`, controls.get(read.missing));
      return;
    }
    context.send({ kind: "event", event, payload: read.payload });
  };
  const resync = (changed: Event) => {
    if (changed.target instanceof Element && changed.target.closest("[data-fill-from]")) return;
    fill?.sync();
  };
  form.addEventListener("input", resync);
  form.addEventListener("click", resync);
  form.append(
    html(doc, "div", { class: "payload-head" }, [
      html(doc, "h3", { class: "payload-title" }, [code(doc, event)]),
      fill?.node ?? null,
    ]),
    html(doc, "div", { class: "payload-body" }, fieldLabels),
    html(doc, "div", { class: "payload-actions" }, [
      problem,
      html(doc, "div", { class: "explore-samples" }, [
        button(doc, ["Send ", code(doc, event)], {
          onClick: submit,
          attrs: { class: "primary", "data-payload-send": event },
        }),
        button(doc, ["Cancel"], {
          onClick: context.close,
          attrs: { "data-payload-cancel": event },
        }),
      ]),
    ]),
  );
  return form;
}

/**
 * Asks for the payload before sending: filled with the first fuzz sample,
 * editable, with the other samples one click away. Nothing is sent until Send.
 */
export function payloadForm(
  doc: Document,
  context: {
    event: string;
    samples: ReadonlyArray<VizJson>;
    /** The event's declared payload fields; null when the type could not be read. */
    fields: ReadonlyArray<VizField> | null;
    /** What the machine holds now; null = nothing to fill from. */
    live?: FillLive | null;
    send: (step: VizStep) => void;
    close: () => void;
  },
): HTMLElement {
  const { event, samples } = context;
  if (context.fields !== null && context.fields.length > 0) {
    return fieldsForm(doc, {
      ...context,
      fields: context.fields,
      samples,
      live: context.live ?? null,
    });
  }
  const known = knownPayload(context.fields, {
    event,
    samples,
    steps: context.live?.steps ?? [],
  });
  const box = html(doc, "textarea", {
    rows: "3",
    "aria-label": `${event} payload JSON`,
    "data-payload-json": event,
  });
  box.value = known === undefined ? "" : (JSON.stringify(known.payload) ?? "");
  const problem = html(doc, "p", { class: "explore-warning", role: "alert", hidden: "" }, [
    "Payload is not valid JSON. Nothing was sent.",
  ]);
  const submit = () => {
    try {
      const payload = box.value.trim() === "" ? null : (JSON.parse(box.value) as VizJson);
      context.send({ kind: "event", event, payload });
    } catch {
      problem.removeAttribute("hidden");
    }
  };
  return html(doc, "div", { class: "explore-payload", "data-payload-form": event }, [
    html(doc, "div", { class: "payload-head" }, [
      html(doc, "h3", { class: "payload-title" }, [code(doc, event)]),
    ]),
    html(doc, "div", { class: "payload-body" }, [
      samples.length === 0
        ? null
        : html(
            doc,
            "div",
            { class: "explore-samples" },
            samples.map((sample, index) =>
              button(doc, [`sample ${index + 1}`], {
                onClick: () => {
                  box.value = JSON.stringify(sample);
                },
                attrs: {
                  "data-sample": String(index),
                  title: JSON.stringify(sample),
                },
              }),
            ),
          ),
      box,
    ]),
    html(doc, "div", { class: "payload-actions" }, [
      problem,
      html(doc, "div", { class: "explore-samples" }, [
        button(doc, ["Send ", code(doc, event)], {
          onClick: submit,
          attrs: { class: "primary", "data-payload-send": event },
        }),
        button(doc, ["Cancel"], {
          onClick: context.close,
          attrs: { "data-payload-cancel": event },
        }),
      ]),
    ]),
  ]);
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
  // An event with payload fields, or one fuzzing sent a payload with, asks for it; the rest send at once.
  const asks = asksForPayload(machine, event);
  const declared = machine.events.find((each) => each.id === event)?.payload ?? null;
  const move = moves.find((each) => each.edge.event === event);
  return html(doc, "li", { "data-send-item": event }, [
    button(doc, [code(doc, event), asks ? " …" : ""], {
      onClick: () =>
        asks
          ? live.compose(event, actor)
          : live.send({ kind: "event", event, payload: null, ...(actor ? { actor } : {}) }),
      attrs: { "data-send": event },
    }),
    asks || declared !== null
      ? null
      : button(doc, ["with payload"], {
          onClick: () => live.compose(event, actor),
          attrs: { "data-send-custom": event },
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
  const groups: MoveGroup[] = ["input", "effect", "internal"];
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
  const groupOf = (event: string): MoveGroup =>
    moves.find((each) => each.edge.event === event)?.group ?? "input";
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

/** One section per actor map: its children, where each is now, and what each handles. */
function childrenSections(
  doc: Document,
  machine: VizMachine,
  live: LiveMoves,
): Array<HTMLElement | null> {
  const { state } = live;
  return machine.maps.map((map) => {
    const children = state.children.filter((child) => child.map === map);
    const heading = html(doc, "h3", {}, [
      code(doc, map),
      children.length === 0
        ? ": no children yet"
        : `: ${children.length} ${children.length === 1 ? "child" : "children"}`,
    ]);
    const rows = children.map((child) => {
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
            child.since === state.steps.length ? " (new)" : "",
            final ? " (final)" : "",
          ]),
          moves,
        ],
      );
    });
    return html(doc, "section", { class: "explore-map", "data-map": map }, [
      heading,
      rows.length === 0 ? null : html(doc, "ul", { class: "explore-children" }, rows),
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

/** The declared fields as a table, or the pretty-printed context with changed lines marked. */
function contextSection(
  doc: Document,
  context: {
    machine: VizMachine;
    value: VizJson;
    previous: VizJson | undefined;
  },
): HTMLElement {
  const { machine, value, previous } = context;
  const body =
    machine.context !== null
      ? fieldsTable(doc, { fields: machine.context, value, previous })
      : prettyContext(doc, value, previous);
  return html(doc, "div", { class: "explore-context" }, [
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

function outcomeText(doc: Document, step: VizLiveStep): Array<Node | string> {
  const region = step.actor === undefined ? undefined : actorText(step.actor);
  const child = step.actor !== undefined && "map" in step.actor ? step.actor : undefined;
  if (step.outcome === "missing") {
    return child === undefined
      ? ["No region ", code(doc, region ?? ""), " in this machine. Nothing ran."]
      : [
          code(doc, child.key),
          " is not in ",
          code(doc, child.map),
          " (it was removed or never added). Nothing ran.",
        ];
  }
  if (step.outcome === "ignored") {
    return ["No handler for ", code(doc, step.event), ` in ${step.from}. Nothing ran.`];
  }
  const names = (id: string) => (region === undefined ? id : localName(id));
  const where =
    child !== undefined
      ? [": ", code(doc, child.map), " ", code(doc, child.key), ": "]
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
    html(doc, "p", { "data-live-outcome": "" }, outcomeText(doc, step)),
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
    step.effects.length === 0 || context.held
      ? null
      : html(doc, "p", { "data-live-effects": "" }, [
          "Effects started: ",
          ...step.effects.flatMap((name, index) => [index === 0 ? "" : ", ", code(doc, name)]),
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
          ...after.map((step, index) =>
            html(doc, "div", { "data-live-after": "" }, [
              html(doc, "p", { class: "muted" }, ["Then ", code(doc, step.event), " came back"]),
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
  const moves: LiveMoves = { state, send: live.send, final, compose: live.compose };
  return [
    ...regionLines(doc, machine, state),
    ...childrenSections(doc, machine, moves),
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
      ? [runsSection(doc, context.machine, live), livePathSection(doc, context, live.state)]
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
  context: { machine: VizMachine; path: ReadonlyArray<ExploreStep>; currents?: string[] },
): void {
  const { machine, path } = context;
  const currents = currentsIn(machine, context);
  const moves = currents.flatMap((current) => movesFrom(machine, current));
  const next = new Set(moves.filter((move) => move.targets.length > 0).map((move) => move.edge.id));
  const reachable = new Set(
    moves.flatMap((move) => move.targets).filter((to) => !currents.includes(to)),
  );
  const taken = new Set(path.map((step) => step.edge));
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-edge-id]")) {
    const id = element.dataset["edgeId"] ?? "";
    element.classList.toggle("taken", taken.has(id));
    element.classList.toggle("next", next.has(id));
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
