import type { Snapshot } from "@mantaq/core";

export interface Tag {
  has(snapshot: Snapshot): boolean;
}

function hasName(snapshot: Snapshot, name: string): boolean {
  if (snapshot.path[0] === name) return true;
  for (const regionSnap of Object.values(snapshot.regions)) {
    if (hasName(regionSnap, name)) return true;
  }
  return false;
}

export function tag(...stateNames: Array<{ name: string }>): Tag {
  const names = stateNames.map((s) => s.name);
  return {
    has: (snapshot: Snapshot) => names.some((name) => hasName(snapshot, name)),
  };
}
