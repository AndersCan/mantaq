import type { Machine } from "@mantaq/core";

/** A `machine(id, { create })` value: a string id and a `create` function. */
export function isMachine(value: unknown): value is Machine {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "create") === "function"
  );
}
