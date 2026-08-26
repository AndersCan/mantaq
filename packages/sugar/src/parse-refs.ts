import type { EventRef, StateRef } from "@mantaq/core";

/**
 * Boundary utility for the `states()` and `events()` helpers. Ref records are
 * built dynamically, keyed by a literal name tuple. TypeScript cannot express
 * that assignment, so the narrowing from the runtime-shaped record to the
 * mapped tuple type happens here — the only place a cast is trusted.
 */
export function parseStateRefs<T>(record: Record<string, StateRef<string, unknown, boolean>>): T {
  return record as T;
}

export function parseEventRefs<T>(record: Record<string, EventRef<string>>): T {
  return record as T;
}
