import type { Snapshot, StateRef } from "@mantaq/core";
import { isIn } from "./snapshot.ts";

export interface Tag {
  has(snapshot: Snapshot): boolean;
}

export function tag(...stateNames: StateRef<string, unknown>[]): Tag {
  const names = stateNames.map((s) => s.name);
  return {
    has: (snapshot: Snapshot) => names.some((name) => isIn(snapshot, name)),
  };
}
