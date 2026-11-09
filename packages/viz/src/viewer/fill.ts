import type { VizField, VizJson, VizLiveState, VizStep } from "../schema.ts";

/** Values for an event's payload fields, copied from one thing the machine holds now. */
export interface FillSource {
  /** Where they come from: `waitingForAdminToAccept`, `context`, `context.requests[1]`, or `fuzz example 1` for a payload fuzzing sent, `Last sent` for what this walk sent. */
  path: string;
  /** Field name to value; only fields whose value fits, in the event's field order. */
  values: Array<{ field: string; value: VizJson }>;
}

const limit = 20;

function isObject(value: unknown): value is Record<string, VizJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function items(path: string, list: VizJson[]) {
  const found: Array<{ path: string; value: Record<string, VizJson> }> = [];
  for (const [index, item] of list.entries()) {
    if (isObject(item)) found.push({ path: `${path}[${index}]`, value: item });
  }
  return found;
}

function candidates(
  live: Pick<VizLiveState, "state" | "payload" | "context">,
): Array<{ path: string; value: Record<string, VizJson> }> {
  const found: Array<{ path: string; value: Record<string, VizJson> }> = [];
  const roots: Array<[string, VizJson]> = [
    [live.state, live.payload],
    ["context", live.context],
  ];
  for (const [path, root] of roots) {
    if (!isObject(root)) continue;
    found.push({ path, value: root });
    for (const key of Object.keys(root)) {
      const child = root[key];
      if (isObject(child)) found.push({ path: `${path}.${key}`, value: child });
      else if (Array.isArray(child)) found.push(...items(`${path}.${key}`, child));
    }
  }
  return found.slice(0, limit);
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
  return values.length === 0 ? null : { path: "Last sent", values };
}

/** Everything the payload could be filled from, best first: what this walk sent, then what the machine holds. [] = nothing fits; the form stays as today. */
export function fillSources(
  fields: ReadonlyArray<VizField>,
  live: Pick<VizLiveState, "state" | "payload" | "context"> & { steps?: ReadonlyArray<VizStep> },
): FillSource[] {
  const sources: Array<{ source: FillSource; filled: number }> = [];
  for (const { path, value } of candidates(live)) {
    const values: FillSource["values"] = [];
    let filled = 0;
    for (const field of fields) {
      if (!Object.hasOwn(value, field.name)) continue;
      const found = value[field.name];
      if (found === undefined || !fits(field, found)) continue;
      values.push({ field: field.name, value: found });
      if (field.input !== "choice") filled += 1;
    }
    if (filled > 0) sources.push({ source: { path, values }, filled });
  }
  sources.sort((a, b) => b.filled - a.filled);
  const typed = typedSource(fields, live.steps ?? []);
  const ordered: FillSource[] = typed === null ? [] : [typed];
  for (const each of sources) ordered.push(each.source);
  return ordered;
}

/** What a click sends for `event`: per field, the latest value this walk sent under that name, else the field's example (required fields), else the fuzzer's first payload's value. Without declared fields: the payload this walk last sent with `event`, else the fuzzer's first. undefined = nothing known. */
export function knownPayload(
  fields: ReadonlyArray<VizField> | null,
  context: { event: string; samples: ReadonlyArray<VizJson>; steps: ReadonlyArray<VizStep> },
): { payload: VizJson } | undefined {
  const { event, samples, steps } = context;
  const [fuzzed] = samples;
  if (fields === null || fields.length === 0) {
    for (const step of steps.toReversed()) {
      if (step.kind === "event" && step.event === event && step.payload !== null) {
        return { payload: step.payload };
      }
    }
    return fuzzed === undefined ? undefined : { payload: fuzzed };
  }
  const typed = typedSource(fields, steps);
  const payload: Record<string, VizJson> = {};
  for (const field of fields) {
    const value = knownValue(field, { typed, fuzzed });
    if (value !== undefined) payload[field.name] = value;
  }
  return { payload };
}

function knownValue(
  field: VizField,
  from: { typed: FillSource | null; fuzzed: VizJson | undefined },
): VizJson | undefined {
  const sent = from.typed?.values.find((each) => each.field === field.name);
  if (sent !== undefined) return sent.value;
  if (!field.optional) return field.sample;
  const fuzz = isObject(from.fuzzed) ? from.fuzzed[field.name] : undefined;
  if (fuzz !== undefined && fits(field, fuzz) && !isTypeDefault(field, fuzz)) return fuzz;
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
  for (let count = Number(digits) + 1; ; count += 1) {
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

/** What the fuzzer makes up for a bare string or number: it says nothing the field's example does not say better. */
function isTypeDefault(field: VizField, value: VizJson): boolean {
  if (field.input === "text") return value === "sample";
  if (field.input === "number") return value === 1;
  return false;
}

const fuzzLimit = 5;

/** Payloads fuzzing sent, as choices for the form: only fields that fit, minus any that repeat the type's examples. */
export function fuzzSources(
  fields: ReadonlyArray<VizField>,
  samples: ReadonlyArray<VizJson>,
): FillSource[] {
  const found: FillSource[] = [];
  const seen = new Set<string>();
  for (const sample of samples) {
    if (found.length >= fuzzLimit) break;
    if (!isObject(sample)) continue;
    const values: FillSource["values"] = [];
    let differs = false;
    for (const field of fields) {
      if (!Object.hasOwn(sample, field.name)) continue;
      const value = sample[field.name];
      if (value === undefined || !fits(field, value)) continue;
      values.push({ field: field.name, value });
      if (JSON.stringify(value) !== JSON.stringify(field.sample)) differs = true;
    }
    if (values.length === 0 || !differs) continue;
    const key = JSON.stringify(values);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ path: `fuzz example ${found.length + 1}`, values });
  }
  return found;
}

/** One button of the form's "Values from" row. */
export interface FillChoice {
  label: string;
  /** Shown on hover: where the values come from; null = the label says it. */
  title: string | null;
  values: FillSource["values"];
}

const choiceLimit = 4;

function withoutRepeats(wanted: ReadonlyArray<FillChoice | undefined>): FillChoice[] {
  const seen = new Set<string>();
  const kept: FillChoice[] = [];
  for (const each of wanted) {
    if (each === undefined) continue;
    const key = JSON.stringify(each.values);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(each);
  }
  return kept;
}

function choiceOf(
  label: string,
  values: FillSource["values"] | undefined,
  title?: string,
): FillChoice | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return { label, title: title ?? null, values };
}

/** The "Values from" buttons, in order: Last sent, Fuzz 1, Fuzz 2, Example, Context. A choice whose values repeat an earlier one is dropped; past four, so is Fuzz 2. Fewer than two: none. */
export function fillChoices(
  fields: ReadonlyArray<VizField>,
  context: {
    live: Pick<VizLiveState, "state" | "payload" | "context"> | null;
    samples: ReadonlyArray<VizJson>;
    steps: ReadonlyArray<VizStep>;
  },
): FillChoice[] {
  const { live, samples, steps } = context;
  const typed = typedSource(fields, steps);
  const held = live === null ? [] : fillSources(fields, { ...live, steps });
  const contextual = held.at(typed === null ? 0 : 1);
  const [first, second] = fuzzSources(fields, samples);
  const examples: FillSource["values"] = fields
    .filter((field) => !field.optional)
    .map((field) => ({ field: field.name, value: field.sample }));
  const wanted = [
    choiceOf("Last sent", typed?.values),
    choiceOf("Fuzz 1", first?.values),
    choiceOf("Fuzz 2", second?.values),
    choiceOf("Example", examples),
    choiceOf("Context", contextual?.values, contextual?.path),
  ];
  const kept = withoutRepeats(wanted);
  const trimmed = kept.length > choiceLimit ? kept.filter((each) => each.label !== "Fuzz 2") : kept;
  return trimmed.length < 2 ? [] : trimmed;
}
