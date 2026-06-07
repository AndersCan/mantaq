import type { Snapshot } from "@mantaq/core";

export function isIn(snapshot: Snapshot, stateRefName: string): boolean {
  if (snapshot.path[0] === stateRefName) return true;
  for (const region of Object.values(snapshot.regions)) {
    if (isIn(region, stateRefName)) return true;
  }
  return false;
}

export function activeLeaves(snapshot: Snapshot): string[] {
  if (Object.keys(snapshot.regions).length === 0) {
    return [snapshot.path.join(".")];
  }
  const leaves: string[] = [];
  for (const [regionName, region] of Object.entries(snapshot.regions)) {
    for (const leaf of activeLeaves(region)) {
      leaves.push(`${snapshot.path[0]}.${regionName}.${leaf}`);
    }
  }
  return leaves;
}
