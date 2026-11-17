import { asksForPayload, payloadSamples } from "../moves.ts";
import type {
  VizActorRef,
  VizEdge,
  VizField,
  VizFuzzSequence,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizStep,
} from "../schema.ts";

/** Field name → the value the person set in the Context tab. */
export type Values = Readonly<Record<string, VizJson>>;

/** Values for an event's payload fields, copied from what this walk sent. */
interface FillSource {
  /** Field name to value; only fields whose value fits, in the event's field order. */
  values: Array<{ field: string; value: VizJson }>;
}

function isObject(value: unknown): value is Record<string, VizJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fits(field: VizField, value: VizJson): boolean {
  switch (field.input) {
    case "text":
      return typeof value === "string" && value !== "";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "choice":
      return field.choices.some((choice) => JSON.stringify(choice) === JSON.stringify(value));
    case "json":
      return true;
  }
}

/** The latest value this walk sent for each field of the same name; null when none fits. */
function typedSource(
  fields: ReadonlyArray<VizField>,
  steps: ReadonlyArray<VizStep>,
): FillSource | null {
  const values: FillSource["values"] = [];
  for (const field of fields) {
    for (const step of steps.toReversed()) {
      if (step.kind !== "event" || !isObject(step.payload)) continue;
      if (!Object.hasOwn(step.payload, field.name)) continue;
      const value = step.payload[field.name];
      if (value === undefined || !fits(field, value)) continue;
      values.push({ field: field.name, value });
      break;
    }
  }
  return values.length === 0 ? null : { values };
}

/** What a click sends for `event`: per field, the value set in the Context tab, else the latest value this walk sent under that name, else the field's example (required fields), else the fuzzer's first payload's value. Without declared fields: the fuzzer's first payload. undefined = nothing known. */
export function knownPayload(
  fields: ReadonlyArray<VizField> | null,
  context: {
    event: string;
    samples: ReadonlyArray<VizJson>;
    steps: ReadonlyArray<VizStep>;
    /** Values set in the Context tab; they win over everything else when they fit. */
    set?: Values;
  },
): { payload: VizJson } | undefined {
  const { samples, steps } = context;
  const set = context.set ?? {};
  const [fuzzed] = samples;
  if (fields === null || fields.length === 0) {
    return fuzzed === undefined ? undefined : { payload: fuzzed };
  }
  const typed = typedSource(fields, steps);
  const payload: Record<string, VizJson> = {};
  for (const field of fields) {
    const value = knownValue(field, { typed, set });
    if (value !== undefined) payload[field.name] = value;
  }
  return { payload };
}

function knownValue(
  field: VizField,
  from: { typed: FillSource | null; set: Values },
): VizJson | undefined {
  const chosen = from.set[field.name];
  if (chosen !== undefined && fits(field, chosen)) return chosen;
  const sent = from.typed?.values.find((each) => each.field === field.name);
  if (sent !== undefined) return sent.value;
  if (!field.optional) return field.sample;
  return undefined;
}

function nextKey(value: string, taken: ReadonlySet<string>): string {
  const match = /^(.*?)(\d+)$/.exec(value);
  if (match === null) {
    for (let count = 2; ; count += 1) {
      if (!taken.has(`${value}-${count}`)) return `${value}-${count}`;
    }
  }
  const [, prefix = "", digits = ""] = match;
  for (let count = BigInt(digits) + 1n; ; count += 1n) {
    if (!taken.has(`${prefix}${count}`)) return `${prefix}${count}`;
  }
}

/** A payload that would start a child under a key that is live gets the next free key instead, when this event started a child under that key earlier in the walk. */
export function freshKeys(
  payload: VizJson,
  context: {
    event: string;
    state: {
      steps: ReadonlyArray<VizStep>;
      children: VizLiveState["children"];
      removed?: VizLiveState["removed"];
    };
  },
): VizJson {
  if (!isObject(payload)) return payload;
  const { event, state } = context;
  const live = new Set(state.children.map((child) => child.key));
  const everyChild = [...state.children, ...(state.removed ?? [])];
  const fresh: Record<string, VizJson> = { ...payload };
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value !== "string" || !live.has(value)) continue;
    const started = state.steps.some(
      (step, index) =>
        step.kind === "event" &&
        step.event === event &&
        isObject(step.payload) &&
        step.payload[name] === value &&
        everyChild.some((child) => child.key === value && child.since === index + 1),
    );
    if (started) fresh[name] = nextKey(value, live);
  }
  return fresh;
}

/** The walk's steps, each followed by the messages parts sent after it that carried a payload. */
function heardSteps(
  steps: ReadonlyArray<VizStep>,
  afters: ReadonlyArray<ReadonlyArray<VizLiveStep>>,
): VizStep[] {
  return steps.flatMap((step, index) => [
    step,
    ...(afters[index] ?? []).flatMap((entry): VizStep[] => {
      const payload = entry.message?.payload;
      return payload === undefined ? [] : [{ kind: "event", event: entry.event, payload }];
    }),
  ]);
}

/** The payload a click on `event` sends: null when it carries no data, else the set values, then what the walk sent or heard, then the examples. */
export function payloadFor(
  machine: VizMachine,
  event: string,
  from: {
    set: Values;
    live: VizLiveState | null;
    afters: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
  },
): VizJson {
  if (!asksForPayload(machine, event)) return null;
  const { live } = from;
  const known = knownPayload(machine.events.find((each) => each.id === event)?.payload ?? null, {
    event,
    samples: payloadSamples(machine, event),
    steps: live === null ? [] : heardSteps(live.steps, from.afters),
    set: from.set,
  });
  if (known === undefined) return null;
  return live === null
    ? known.payload
    : freshKeys(known.payload, {
        event,
        state: { steps: live.steps, children: live.children, removed: live.removed },
      });
}

function sortedJson(value: VizJson | undefined): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (isObject(value)) {
    const body = Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** True when two steps are the same, whatever order their payload keys came in. */
export function sameStep(a: VizStep, b: VizStep): boolean {
  return sortedJson(a as unknown as VizJson) === sortedJson(b as unknown as VizJson);
}

const MOST_CANDIDATES = 16;

/** `payload` with the values set in the Context tab laid over its declared fields. */
function withSet(fields: ReadonlyArray<VizField> | null, payload: VizJson, set: Values): VizJson {
  if (fields === null || !isObject(payload)) return payload;
  const laid: Record<string, VizJson> = { ...payload };
  for (const field of fields) {
    const value = set[field.name];
    if (value !== undefined && fits(field, value)) laid[field.name] = value;
  }
  return laid;
}

function actorKey(actor: VizActorRef | undefined): string {
  return sortedJson((actor ?? null) as unknown as VizJson);
}

/** The next payload of each corpus run the walk is on, longest run first. */
function runPayloads(
  corpus: ReadonlyArray<VizFuzzSequence>,
  next: { walk: ReadonlyArray<VizStep>; event: string; actor: VizActorRef | undefined },
): VizJson[] {
  const { walk, event } = next;
  return corpus
    .filter((sequence) =>
      walk.every((step, index) => {
        const there = sequence.steps[index];
        return there !== undefined && sameStep(there, step);
      }),
    )
    .toSorted((a, b) => b.steps.length - a.steps.length)
    .flatMap((sequence) => {
      const step = sequence.steps[walk.length];
      const same =
        step?.kind === "event" &&
        step.event === event &&
        actorKey(step.actor) === actorKey(next.actor);
      return same && step.payload !== null ? [step.payload] : [];
    });
}

/** The fuzz payloads of the event: those of runs that found `feature` first, then the rest. */
function fuzzPayloads(machine: VizMachine, event: string, feature: string): VizJson[] {
  const found = new Set(
    (machine.fuzz?.corpus ?? [])
      .filter((sequence) => sequence.discovered.includes(feature))
      .flatMap((sequence) =>
        sequence.steps.flatMap((step) =>
          step.kind === "event" && step.event === event && step.payload !== null
            ? [sortedJson(step.payload)]
            : [],
        ),
      ),
  );
  const samples = payloadSamples(machine, event);
  return [
    ...samples.filter((each) => found.has(sortedJson(each))),
    ...samples.filter((each) => !found.has(sortedJson(each))),
  ];
}

/**
 * The payloads a click on `edge` may send, best first: the default (`payloadFor`), the next step of a
 * fuzz run the walk is on, and the fuzz payloads of the event (those of runs that found this arrow
 * first). With an empty walk the default goes first, else the run does. At most 16, no repeats.
 */
export function arrowCandidates(
  machine: VizMachine,
  edge: VizEdge,
  from: {
    set: Values;
    live: VizLiveState | null;
    afters: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
    actor: VizActorRef | undefined;
  },
): VizJson[] {
  const { live, set } = from;
  const fallback = payloadFor(machine, edge.event, { set, live, afters: from.afters });
  const corpus = machine.fuzz?.corpus ?? [];
  if (!asksForPayload(machine, edge.event) || corpus.length === 0) return [fallback];
  const fields = machine.events.find((each) => each.id === edge.event)?.payload ?? null;
  const walk = live?.steps ?? [];
  const runs = runPayloads(corpus, { walk, event: edge.event, actor: from.actor });
  const feature = `edge:${edge.from}>${edge.event}>${edge.to ?? ""}`;
  const fuzzed = fuzzPayloads(machine, edge.event, feature);
  const laid = (list: VizJson[]) => list.map((each) => withSet(fields, each, set));
  const ordered =
    walk.length === 0
      ? [fallback, ...laid(runs), ...laid(fuzzed)]
      : [...laid(runs), fallback, ...laid(fuzzed)];
  return distinct(ordered).slice(0, MOST_CANDIDATES);
}

function distinct(list: ReadonlyArray<VizJson>): VizJson[] {
  const seen = new Map<string, VizJson>();
  for (const each of list) seen.set(sortedJson(each), seen.get(sortedJson(each)) ?? each);
  return [...seen.values()];
}

/** One field per name across the machine's events, the first event that requires it wins, else the first: the Context tab's rows. */
export function valueFields(machine: VizMachine): VizField[] {
  const byName = new Map<string, VizField>();
  for (const event of machine.events) {
    for (const field of event.payload ?? []) {
      const seen = byName.get(field.name);
      if (seen === undefined || (seen.optional && !field.optional)) byName.set(field.name, field);
    }
  }
  return [...byName.values()];
}

/** What `field` is sent with when nothing is set: the latest value the walk sent or heard under that name, else the example; undefined = left out. */
export function defaultValue(
  field: VizField,
  from: {
    live: VizLiveState | null;
    afters: ReadonlyArray<ReadonlyArray<VizLiveStep>>;
    events?: ReadonlyArray<string>;
  },
): VizJson | undefined {
  const { live } = from;
  const steps = live === null ? [] : heardSteps(live.steps, from.afters);
  const sent = typedSource([field], steps)?.values[0]?.value;
  if (sent !== undefined) {
    const event = from.events?.[0];
    if (live === null || event === undefined) return sent;
    const fresh = freshKeys(
      { [field.name]: sent },
      { event, state: { steps: live.steps, children: live.children, removed: live.removed } },
    );
    return isObject(fresh) ? fresh[field.name] : sent;
  }
  return field.optional ? undefined : field.sample;
}

/** The text a field's input shows for `value`. */
export function valueText(field: VizField, value: VizJson): string {
  if (typeof value === "string" && field.input !== "json") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

/** The value a person's text means for `field`; undefined when empty or not valid (then the default is sent). */
export function parseValue(field: VizField, text: string): VizJson | undefined {
  if (text.trim() === "") return undefined;
  switch (field.input) {
    case "text":
      return text;
    case "number": {
      const number = Number(text);
      return Number.isFinite(number) ? number : undefined;
    }
    case "choice":
      return field.choices.find((choice) => valueText(field, choice) === text);
    case "json":
      try {
        return JSON.parse(text) as VizJson;
      } catch {
        return undefined;
      }
  }
}

/** `name=<json>` per value, as kept in the address (`?value=`). */
export function encodeValues(values: Values): string[] {
  return Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`);
}

/** The inverse of `encodeValues`; entries with no name, no `=` or bad JSON are skipped. */
export function decodeValues(encoded: ReadonlyArray<string>): Values {
  const values: Record<string, VizJson> = {};
  for (const entry of encoded) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    try {
      values[entry.slice(0, at)] = JSON.parse(entry.slice(at + 1)) as VizJson;
    } catch {
      continue;
    }
  }
  return values;
}
