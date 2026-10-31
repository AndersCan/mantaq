import type { Snapshot } from "@mantaq/core";

export const INITIAL_NODE_ID = "__initial__";

/** Source of `onAny` edges: any non-final state of the machine (`region.*` inside a region). */
export const ANY_NODE_NAME = "*";

export function isAnyNode(id: string): boolean {
  return id === ANY_NODE_NAME || id.endsWith(`.${ANY_NODE_NAME}`);
}

export function collectActiveStates(
  snapshot: Snapshot,
  options: { prefix: string; activeSet: Set<string> },
): void {
  if (!snapshot.path) return;
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = nodeId({ prefix: options.prefix, name: currentName });
  options.activeSet.add(fullId);

  if (snapshot.regions && !snapshot.done && !snapshot.error) {
    for (const [regionName, regionSnapshot] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnapshot, { prefix: regionName, activeSet: options.activeSet });
    }
  }
}

export function nodeId(identity: { prefix: string; name: string }): string {
  return identity.prefix ? `${identity.prefix}.${identity.name}` : identity.name;
}

export function collectActorsFromSnapshot(snapshot: Snapshot): Set<string> {
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, { prefix: "", activeSet });
  return activeSet;
}
