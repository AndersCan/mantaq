import type { Snapshot } from "@mantaq/core";

function matchSnapshot(snapshot: Snapshot, parts: string[], index: number): boolean {
  const stateName = snapshot.path[0];

  for (let end = index; end < parts.length; end++) {
    const candidate = parts.slice(index, end + 1).join(".");
    if (candidate !== stateName) continue;

    if (end === parts.length - 1) return true;

    const regionSnap = snapshot.regions[parts[end + 1]];
    if (!regionSnap) return false;

    if (end + 1 === parts.length - 1) return true;

    return matchSnapshot(regionSnap, parts, end + 2);
  }

  return false;
}

export function matches(actor: { snapshot(): Snapshot }, pattern: string): boolean {
  if (!pattern || pattern.endsWith(".")) return false;
  const parts = pattern.split(".");
  return matchSnapshot(actor.snapshot(), parts, 0);
}
