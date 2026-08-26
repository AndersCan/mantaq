import type { Snapshot } from "@mantaq/core";

function isInState(options: { snapshot: Snapshot; stateName: string }): boolean {
  if (options.snapshot.path[0] === options.stateName) return true;
  for (const region of Object.values(options.snapshot.regions)) {
    if (isInState({ snapshot: region, stateName: options.stateName })) return true;
  }
  return false;
}

/**
 * True when any of the named states is active anywhere in the snapshot tree.
 */
export function isIn(snapshot: Snapshot, ...stateNames: [stateName: string]): boolean {
  return stateNames.some((stateName) => isInState({ snapshot, stateName }));
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
