import type { AtlasDocument } from "./schema.ts";

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
export function serializeAtlas(document: AtlasDocument): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}
