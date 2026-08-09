import type { AnyStateRef } from "./state.ts";
import type { Snapshot } from "./actor-types.ts";

export function buildSnapshot<C>(
  s: AnyStateRef,
  regions: Record<string, { snapshot(): Snapshot }>,
  context: C,
): Snapshot<C> {
  const path = [s.name];
  const regionSnapshots: Record<string, Snapshot> = {};

  for (const [regionName, child] of Object.entries(regions)) {
    regionSnapshots[regionName] = child.snapshot();
  }

  const snap: Snapshot<C> = { path, context, regions: regionSnapshots };

  if (s.isFinal) {
    snap.done = true;
  }

  return snap;
}
