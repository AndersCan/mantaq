import { asksForPayload, movesFrom, stateAfter, unhandledSends } from "../moves.ts";
import { coveredByAny } from "../schema.ts";
import type { ExploreStep, Move, MoveGroup } from "../moves.ts";
import type {
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizLiveTimer,
  VizMachine,
  VizStep,
} from "../schema.ts";
import { changedKeys, contextLines } from "./context-diff.ts";
import { html } from "./dom.ts";
import { fillSources } from "./fill.ts";
import type { FillSource } from "./fill.ts";
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
    send: (step: VizStep) => void;
    previous?: VizJson;
    /** Replace the walk with these steps from a fresh actor. */
    play: (steps: ReadonlyArray<VizStep>, run?: string) => void;
    /** Open the payload form for an event, or close it with null. */
    compose: (event: string | null) => void;
  };
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

interface LiveMoves {
  state: VizLiveState;
  send: (step: VizStep) => void;
  final: boolean;
  compose: (event: string | null) => void;
}

/** One input per declared payload field, started at the field's sample. */
function fieldInput(doc: Document, field: VizField): HTMLInputElement | HTMLSelectElement {
  const attrs = { "data-field": field.name, "aria-label": field.name };
  if (field.input === "choice") {
    const select = html(doc, "select", attrs);
    if (field.optional) select.append(html(doc, "option", { value: "" }, ["(not set)"]));
    for (const choice of field.choices) {
      const option = html(doc, "option", { value: JSON.stringify(choice) }, [
        typeof choice === "string" ? choice : JSON.stringify(choice),
      ]);
      select.append(option);
    }
    select.value = field.optional ? "" : JSON.stringify(field.sample);
    return select;
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
  return input;
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

/** The payload typed into the field inputs, or the name of a json field that did not parse. */
function readFields(
  fields: ReadonlyArray<VizField>,
  inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement>,
): { payload: Record<string, VizJson> } | { bad: string } | { missing: string } {
  const payload: Record<string, VizJson> = {};
  for (const field of fields) {
    const read = readField(field, inputs.get(field.name)?.value ?? "");
    if ("bad" in read) return { bad: field.name };
    if ("missing" in read) return { missing: field.name };
    if (read.value !== undefined) payload[field.name] = read.value;
  }
  return { payload };
}

function shown(value: VizJson): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

function filledText(field: VizField, value: VizJson): string {
  if (field.input === "text" && typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

/** "Values from": fills the inputs from one source, or back to the type's samples. */
function fillPicker(
  doc: Document,
  context: {
    fields: ReadonlyArray<VizField>;
    inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement>;
    sources: ReadonlyArray<FillSource>;
  },
): HTMLElement {
  const { fields, inputs, sources } = context;
  const select = html(doc, "select", { "data-fill-from": "", "aria-label": "Values from" });
  sources.forEach((source, index) => {
    const values = source.values.map((each) => `${each.field} ${shown(each.value)}`);
    select.append(
      html(doc, "option", { value: String(index) }, [`${source.path}: ${values.join(", ")}`]),
    );
  });
  select.append(html(doc, "option", { value: "" }, ["The type's samples"]));
  const apply = () => {
    for (const field of fields) {
      const input = inputs.get(field.name);
      if (input !== undefined) input.value = fieldInput(doc, field).value;
    }
    const source = sources[Number(select.value)];
    if (select.value === "" || source === undefined) return;
    for (const { field: name, value } of source.values) {
      const field = fields.find((each) => each.name === name);
      const input = inputs.get(name);
      if (field !== undefined && input !== undefined) input.value = filledText(field, value);
    }
  };
  select.addEventListener("change", apply);
  select.value = "0";
  apply();
  return html(doc, "label", { class: "explore-field", "data-fill": "" }, [
    html(doc, "strong", {}, ["Values from"]),
    select,
  ]);
}

function fieldsForm(
  doc: Document,
  context: {
    event: string;
    fields: ReadonlyArray<VizField>;
    live: Pick<VizLiveState, "state" | "payload" | "context"> | null;
    send: (step: VizStep) => void;
    close: () => void;
  },
): HTMLElement {
  const { event, fields } = context;
  const inputs = new Map(fields.map((field) => [field.name, fieldInput(doc, field)] as const));
  const sources = context.live === null ? [] : fillSources(fields, context.live);
  const fill = sources.length === 0 ? null : fillPicker(doc, { fields, inputs, sources });
  const problem = html(doc, "p", { class: "explore-warning", role: "alert", hidden: "" });
  const submit = () => {
    const read = readFields(fields, inputs);
    if ("bad" in read || "missing" in read) {
      problem.textContent =
        "bad" in read
          ? `Not sent: ${read.bad} is not valid JSON.`
          : `Not sent: ${read.missing} is required.`;
      problem.removeAttribute("hidden");
      return;
    }
    context.send({ kind: "event", event, payload: read.payload });
  };
  return html(doc, "div", { class: "explore-payload", "data-payload-form": event }, [
    html(doc, "p", {}, ["Payload for ", code(doc, event), ":"]),
    fill,
    ...fields.map((field) =>
      html(doc, "label", { class: "explore-field" }, [
        html(doc, "span", {}, [
          html(doc, "strong", {}, [field.name]),
          " ",
          html(doc, "span", { class: "muted" }, [field.type]),
        ]),
        field.doc === null ? null : html(doc, "span", { class: "muted" }, [field.doc]),
        inputs.get(field.name) ?? null,
      ]),
    ),
    problem,
    html(doc, "div", { class: "explore-samples" }, [
      button(doc, ["Send ", code(doc, event)], {
        onClick: submit,
        attrs: { "data-payload-send": event },
      }),
      button(doc, ["Cancel"], {
        onClick: context.close,
        attrs: { "data-payload-cancel": event },
      }),
    ]),
  ]);
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
    live?: Pick<VizLiveState, "state" | "payload" | "context"> | null;
    send: (step: VizStep) => void;
    close: () => void;
  },
): HTMLElement {
  const { event, samples } = context;
  if (context.fields !== null && context.fields.length > 0) {
    return fieldsForm(doc, { ...context, fields: context.fields, live: context.live ?? null });
  }
  const first = samples[0];
  const box = html(doc, "textarea", {
    rows: "3",
    "aria-label": `${event} payload JSON`,
    "data-payload-json": event,
  });
  box.value = first === undefined ? "" : JSON.stringify(first);
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
    html(doc, "p", {}, [
      "Payload for ",
      code(doc, event),
      samples.length === 0
        ? ". No fuzz samples: type the JSON the handler expects."
        : ". Edit it, or pick a fuzz sample:",
    ]),
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
              attrs: { "data-sample": String(index), title: JSON.stringify(sample) },
            }),
          ),
        ),
    box,
    problem,
    html(doc, "div", { class: "explore-samples" }, [
      button(doc, ["Send ", code(doc, event)], {
        onClick: submit,
        attrs: { "data-payload-send": event },
      }),
      button(doc, ["Cancel"], {
        onClick: context.close,
        attrs: { "data-payload-cancel": event },
      }),
    ]),
  ]);
}

function liveMovesSection(doc: Document, machine: VizMachine, live: LiveMoves): HTMLElement {
  const current = live.state.state;
  if (live.final) {
    return html(doc, "p", { class: "explore-end explore-done", role: "status" }, [
      html(doc, "strong", {}, ["Done."]),
      ` ${current} is final: the actor has stopped.`,
    ]);
  }
  const moves = movesFrom(machine, current);
  const handled = new Set(moves.map((move) => move.edge.event));
  const inputs = machine.events.filter((event) => !event.internal).map((event) => event.id);
  const events = [...new Set([...handled, ...inputs])].sort();
  const groups: MoveGroup[] = ["input", "effect", "internal"];
  const item = (event: string) => {
    // An event with payload fields, or one fuzzing sent a payload with, asks for it; the rest send at once.
    const asks = asksForPayload(machine, event);
    const declared = machine.events.find((each) => each.id === event)?.payload ?? null;
    const move = moves.find((each) => each.edge.event === event);
    return html(doc, "li", { "data-send-item": event }, [
      button(doc, [code(doc, event), asks ? " …" : ""], {
        onClick: () =>
          asks ? live.compose(event) : live.send({ kind: "event", event, payload: null }),
        attrs: { "data-send": event },
      }),
      asks || declared !== null
        ? null
        : button(doc, ["with payload"], {
            onClick: () => live.compose(event),
            attrs: { class: "link", "data-send-custom": event },
          }),
      handled.has(event)
        ? null
        : html(doc, "span", { class: "muted", "data-ignored": "" }, [` ignored in ${current}`]),
      move === undefined || move.sentBy.length === 0
        ? null
        : html(doc, "span", { class: "muted", "data-sent-by": move.sentBy.join(",") }, [
            ` from ${move.sentBy.join(", ")}`,
          ]),
      move === undefined ? null : docNote(doc, { text: move.edge.doc, scope: "edge" }),
    ]);
  };
  const groupOf = (event: string): MoveGroup =>
    moves.find((each) => each.edge.event === event)?.group ?? "input";
  return html(
    doc,
    "div",
    { class: "explore-moves" },
    groups.flatMap((group) => {
      const members = events.filter((event) => groupOf(event) === group);
      return members.length === 0
        ? []
        : [
            html(doc, "h3", {}, [GROUP_TITLES[group]]),
            html(doc, "ul", { "data-group": group }, members.map(item)),
          ];
    }),
  );
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
  context: { fields: ReadonlyArray<VizField>; value: VizJson; previous: VizJson | undefined },
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
          { "data-context-field": field.name, "data-context-changed": changed ? "" : null },
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
  context: { machine: VizMachine; value: VizJson; previous: VizJson | undefined },
): HTMLElement {
  const { machine, value, previous } = context;
  const note = html(doc, "p", { class: "muted", "data-context-note": "" }, [
    "The machine starts with this context. You can't type it in: only its handlers change it, when you send events.",
  ]);
  const body =
    machine.context !== null
      ? fieldsTable(doc, { fields: machine.context, value, previous })
      : prettyContext(doc, value, previous);
  return html(doc, "div", { class: "explore-context" }, [
    note,
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

function stepLines(
  doc: Document,
  context: { machine: VizMachine; step: VizLiveStep; before: VizJson | undefined },
): Array<HTMLElement | null> {
  const { machine, step, before } = context;
  const because = becauseOf(machine, step);
  const changed = changedKeys(before, step.context);
  return [
    html(
      doc,
      "p",
      { "data-live-outcome": "" },
      step.outcome === "ignored"
        ? ["No handler for ", code(doc, step.event), ` in ${step.from}. Nothing ran.`]
        : [
            code(doc, step.event),
            step.outcome === "transition"
              ? `: ${step.from} → ${step.to}`
              : `: handled in ${step.from}, stays`,
          ],
    ),
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
    step.effects.length === 0
      ? null
      : html(doc, "p", { "data-live-effects": "" }, [
          "Effects started: ",
          ...step.effects.flatMap((name, index) => [index === 0 ? "" : ", ", code(doc, name)]),
        ]),
  ];
}

function liveResultSection(
  doc: Document,
  live: { machine: VizMachine; state: VizLiveState; previous: VizJson | undefined },
): HTMLElement {
  const { machine, state, previous } = live;
  const { last, after } = state;
  return html(doc, "div", { class: "explore-live" }, [
    last === null
      ? html(doc, "p", { class: "muted" }, ["Nothing has run yet."])
      : html(doc, "div", { class: "explore-outcome", "data-outcome": last.outcome }, [
          ...stepLines(doc, { machine, step: last, before: previous }),
          last.error === null
            ? null
            : html(doc, "p", { class: "explore-warning", role: "alert", "data-live-error": "" }, [
                `Handler threw: ${last.error}`,
              ]),
          ...after.map((step, index) =>
            html(doc, "div", { "data-live-after": "" }, [
              html(doc, "p", { class: "muted" }, ["Then ", code(doc, step.event), " came back"]),
              ...stepLines(doc, {
                machine,
                step,
                before: (index === 0 ? last : after[index - 1])?.context,
              }),
              step.error === null
                ? null
                : html(
                    doc,
                    "p",
                    { class: "explore-warning", role: "alert", "data-live-error": "" },
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

export interface ExploreParts {
  /** Where the walk is and what can happen next. */
  step: HTMLElement;
  /** Live only: the actor's context. */
  context: HTMLElement | null;
  /** Runs and the steps taken so far. */
  path: HTMLElement;
}

/** The walk, split for the panel's tabs. */
export function explorePanel(doc: Document, context: ExploreContext): ExploreParts {
  const { machine, path, live } = context;
  const current = live?.state.state ?? stateAfter(machine, path) ?? "";
  const final = machine.states.find((state) => state.id === current)?.final === true;
  const length = live?.state.steps.length ?? path.length;
  const step = html(
    doc,
    "section",
    { class: "explore", "data-current": current, "data-done": final ? "" : null },
    [
      live
        ? html(doc, "p", { class: "explore-note", "data-live-note": "" }, [
            "The real machine runs here, in your browser. Effects run with the defaults the machine uses when it is built from a clock alone. While a state's effect runs, you can answer for it: pick what it reports under Effect reports back. Time stands still: timers fire only when you advance them.",
          ])
        : null,
      ...nowSection(doc, machine, { current, final }),
      ...(live
        ? [
            liveResultSection(doc, { machine, state: live.state, previous: live.previous }),
            effectsSection(doc, machine, current),
            liveMovesSection(doc, machine, {
              state: live.state,
              send: live.send,
              final,
              compose: live.compose,
            }),
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
    ],
  );
  return {
    step,
    context: live
      ? contextSection(doc, { machine, value: live.state.context, previous: live.previous })
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
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g.chip")) {
    element.classList.toggle("running", element.dataset["state"] === current);
  }
  for (const element of root.querySelectorAll<SVGGElement>(".graph g[data-node-id]")) {
    const id = element.dataset["nodeId"];
    element.classList.toggle("current", id === current);
    element.classList.toggle("reachable", id !== undefined && reachable.has(id));
  }
}
