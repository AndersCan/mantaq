import type { VizJson } from "../schema.ts";

export interface ContextLine {
  text: string;
  changed: boolean;
}

function same(left: VizJson | undefined, right: VizJson | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function childOf(value: VizJson | undefined, key: string): VizJson | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return /^\d+$/.test(key) ? value[Number(key)] : undefined;
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function lines(
  value: VizJson,
  context: { before: VizJson | undefined; depth: number; label: string; comma: string },
): ContextLine[] {
  const { before, depth, label, comma } = context;
  const pad = "  ".repeat(depth);
  const entries: Array<[string, VizJson]> = Array.isArray(value)
    ? value.map((item, index): [string, VizJson] => [String(index), item])
    : value !== null && typeof value === "object"
      ? Object.entries(value)
      : [];
  if (entries.length === 0) {
    const text = JSON.stringify(value) ?? "undefined";
    return [{ text: `${pad}${label}${text}${comma}`, changed: !same(value, before) }];
  }
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  const body = entries.flatMap(([key, item], index) =>
    lines(item, {
      before: childOf(before, key),
      depth: depth + 1,
      label: Array.isArray(value) ? "" : `${JSON.stringify(key)}: `,
      comma: index === entries.length - 1 ? "" : ",",
    }),
  );
  return [
    { text: `${pad}${label}${open}`, changed: false },
    ...body,
    { text: `${pad}${close}${comma}`, changed: false },
  ];
}

/**
 * The context pretty-printed like `JSON.stringify(value, null, 2)`, one entry per
 * line, with the lines whose value is new or different from `before` marked.
 * `before` of undefined marks nothing.
 */
export function contextLines(value: VizJson, before: VizJson | undefined): ContextLine[] {
  const marked = lines(value, { before, depth: 0, label: "", comma: "" });
  return before === undefined ? marked.map((line) => ({ ...line, changed: false })) : marked;
}

/** Top-level keys whose JSON differs between two contexts, in the order of `after` then keys only in `before`. */
export function changedKeys(before: VizJson | undefined, after: VizJson | undefined): string[] {
  const keysOf = (value: VizJson | undefined): string[] =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const keys = [...new Set([...keysOf(after), ...keysOf(before)])];
  return keys.filter((key) => !same(childOf(before, key), childOf(after, key)));
}
