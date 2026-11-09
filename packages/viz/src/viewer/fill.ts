import type { VizField, VizJson, VizLiveState, VizStep } from "../schema.ts";

/** Values for an event's payload fields, copied from one thing the machine holds now. */
export interface FillSource {
  /** Where they come from: `waitingForAdminToAccept`, `context`, `context.requests[1]`, or `fuzz example 1` for a payload fuzzing sent. */
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
  return values.length === 0 ? null : { path: "you typed", values };
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

/** What a click sends for `event`: per field, the latest value this walk sent under that name, else the fuzzer's first payload's value, else the field's example (required fields only). Without declared fields: the payload this walk last sent with `event`, else the fuzzer's first. undefined = nothing known. */
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
  const fuzz = isObject(from.fuzzed) ? from.fuzzed[field.name] : undefined;
  if (fuzz !== undefined && fits(field, fuzz) && !isTypeDefault(field, fuzz)) return fuzz;
  return field.optional ? undefined : field.sample;
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
