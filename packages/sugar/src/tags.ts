import { isIn } from "./snapshot.ts";
import type { Snapshot, StateRef } from "@mantaq/core";

export interface Tag {
  has(snapshot: Snapshot): boolean;
}

export function tag(...stateRefs: StateRef<string, unknown>[]): Tag {
  const names = stateRefs.map((ref) => ref.name);
  return {
    has: (snapshot: Snapshot) => names.some((name) => isIn(snapshot, name)),
  };
}
