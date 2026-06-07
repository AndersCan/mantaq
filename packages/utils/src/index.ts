import type { Snapshot } from "@mantaq/core";

export function statePath(snapshot: Snapshot): string {
  return snapshot.path.join(".");
}

export function isDone(snapshot: Snapshot): boolean {
  return snapshot.done === true;
}

export function flattenSnapshot(snapshot: Snapshot): Snapshot[] {
  const results: Snapshot[] = [snapshot];
  for (const region of Object.values(snapshot.regions)) {
    results.push(...flattenSnapshot(region));
  }
  return results;
}
