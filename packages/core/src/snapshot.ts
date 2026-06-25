import type { AnyStateRef } from "./state.ts";
import type { Snapshot } from "./actor-types.ts";

export function buildSnapshot(
  s: AnyStateRef,
  regions: Record<string, { snapshot(): Snapshot }>,
): Snapshot {
  const path = [s.name];
  const regionSnapshots: Record<string, Snapshot> = {};

  for (const [regionName, child] of Object.entries(regions)) {
    regionSnapshots[regionName] = child.snapshot();
  }

  const snap: Snapshot = { path, regions: regionSnapshots };

  if (s.isFinal) {
    snap.done = true;
  }

  return snap;
}
