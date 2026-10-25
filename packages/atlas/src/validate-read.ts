import type { AtlasCoverage, AtlasJson } from "./schema.ts";

/** One problem found while reading a document, with a JSON-path-like location. */
export interface AtlasIssue {
  path: string;
  message: string;
}

export type JsonObject = Record<string, unknown>;

/** Collects issues; every read returns a placeholder on failure so reading continues. */
export interface Reader {
  issues: AtlasIssue[];
}

export interface Field {
  record: JsonObject;
  key: string;
  path: string;
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function report(reader: Reader, issue: AtlasIssue): void {
  reader.issues.push(issue);
}

function fail<T>(reader: Reader, at: Field, context: { message: string; fallback: T }): T {
  report(reader, { path: `${at.path}.${at.key}`, message: context.message });
  return context.fallback;
}

export function readString(reader: Reader, at: Field): string {
  const value = at.record[at.key];
  return typeof value === "string"
    ? value
    : fail(reader, at, { message: "expected string", fallback: "" });
}

export function readNullableString(reader: Reader, at: Field): string | null {
  return at.record[at.key] === null ? null : readString(reader, at);
}

export function readBoolean(reader: Reader, at: Field): boolean {
  const value = at.record[at.key];
  return typeof value === "boolean"
    ? value
    : fail(reader, at, { message: "expected boolean", fallback: false });
}

export function readInteger(reader: Reader, at: Field): number {
  const value = at.record[at.key];
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fail(reader, at, { message: "expected integer", fallback: 0 });
}

export function readStrings(reader: Reader, at: Field): string[] {
  const value = at.record[at.key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return fail(reader, at, { message: "expected string[]", fallback: [] });
}

export function readEnum<T extends string>(
  reader: Reader,
  at: Field,
  allowed: ReadonlyArray<T>,
): T | undefined {
  const value = at.record[at.key];
  const match = allowed.find((candidate) => candidate === value);
  if (match !== undefined) return match;
  return fail(reader, at, {
    message: `expected one of ${allowed.join(", ")}`,
    fallback: undefined,
  });
}

export function readCoverage(reader: Reader, at: Field): AtlasCoverage | null {
  const value = at.record[at.key];
  if (value === null) return null;
  const hits = isRecord(value) ? value["hits"] : undefined;
  if (typeof hits === "number" && Number.isInteger(hits)) return { hits };
  return fail(reader, at, { message: "expected null or { hits: integer }", fallback: null });
}

function toJson(value: unknown): AtlasJson | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(toJson);
    return items.every((item) => item !== undefined)
      ? items.filter((item) => item !== undefined)
      : undefined;
  }
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).map(([key, child]) => [key, toJson(child)] as const);
  if (entries.some(([, child]) => child === undefined)) return undefined;
  return Object.fromEntries(
    entries.flatMap(([key, child]) => (child === undefined ? [] : [[key, child]])),
  );
}

export function readJson(reader: Reader, at: Field): AtlasJson {
  const value = toJson(at.record[at.key]);
  return value === undefined
    ? fail(reader, at, { message: "expected JSON value", fallback: null })
    : value;
}

export function readList<T>(
  reader: Reader,
  at: Field,
  item: (record: JsonObject, path: string) => T,
): T[] {
  const value = at.record[at.key];
  if (!Array.isArray(value)) return fail(reader, at, { message: "expected array", fallback: [] });
  return value.flatMap((entry, index) => {
    const path = `${at.path}.${at.key}[${index}]`;
    if (isRecord(entry)) return [item(entry, path)];
    report(reader, { path, message: "expected object" });
    return [];
  });
}
