import type { VizField, VizJson, VizLiveState, VizStep } from "../schema.ts";

/** Values for an event's payload fields, copied from what this walk sent. */
interface FillSource {
  /** Where they come from: `Last sent` for what this walk sent. */
  path: string;
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
  return values.length === 0 ? null : { path: "Last sent", values };
}

/** The latest payload this walk sent (or heard) whose keys are exactly the example's: another event carrying the same fields. */
function sameShape(
  steps: ReadonlyArray<VizStep>,
  example: VizJson | undefined,
): VizJson | undefined {
  if (!isObject(example)) return undefined;
  const keys = Object.keys(example).sort().join(",");
  if (keys === "") return undefined;
  for (const step of steps.toReversed()) {
    if (step.kind !== "event" || !isObject(step.payload)) continue;
    if (Object.keys(step.payload).sort().join(",") === keys) return step.payload;
  }
  return undefined;
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
    const shaped = sameShape(steps, fuzzed);
    if (shaped !== undefined) return { payload: shaped };
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

/** What the fuzzer makes up for a bare string or number: it says nothing the field's example does not say better. */
function isTypeDefault(field: VizField, value: VizJson): boolean {
  if (field.input === "text") return value === "sample";
  if (field.input === "number") return value === 1;
  return false;
}
