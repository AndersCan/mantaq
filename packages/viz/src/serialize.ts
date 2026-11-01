import type { VizDocument } from "./schema.ts";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortKeys(child)]),
  );
}

/** Byte-stable JSON: sorted object keys, two-space indent, trailing newline. */
export function serializeViz(document: VizDocument): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}
