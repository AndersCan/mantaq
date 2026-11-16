import type { VizJson } from "../schema.ts";

function same(left: VizJson | undefined, right: VizJson | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function childOf(value: VizJson | undefined, key: string): VizJson | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return /^\d+$/.test(key) ? value[Number(key)] : undefined;
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

/** Top-level keys whose JSON differs between two contexts, in the order of `after` then keys only in `before`. */
export function changedKeys(before: VizJson | undefined, after: VizJson | undefined): string[] {
  const keysOf = (value: VizJson | undefined): string[] =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const keys = [...new Set([...keysOf(after), ...keysOf(before)])];
  return keys.filter((key) => !same(childOf(before, key), childOf(after, key)));
}
