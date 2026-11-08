import type { VizField, VizJson, VizLiveState } from "../schema.ts";

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

/** Everything the payload could be filled from, best first. [] = nothing fits; the form stays as today. */
export function fillSources(
  fields: ReadonlyArray<VizField>,
  live: Pick<VizLiveState, "state" | "payload" | "context">,
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
  const ordered: FillSource[] = [];
  for (const each of sources) ordered.push(each.source);
  return ordered;
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
