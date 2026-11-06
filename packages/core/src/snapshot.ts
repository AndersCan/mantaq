import type { ErrorInfo, Snapshot } from "./actor-types.ts";
import type { AnyStateRef } from "./state.ts";

export function buildSnapshot<C>(options: {
  stateRef: AnyStateRef;
  regions: Record<string, { snapshot(): Snapshot }>;
  context: C;
  error?: ErrorInfo | undefined;
  payload?: unknown;
}): Snapshot<C> {
  const { stateRef, regions, context } = options;
  const path = [stateRef.name];
  const regionSnapshots: Record<string, Snapshot> = {};

  for (const [regionName, child] of Object.entries(regions)) {
    regionSnapshots[regionName] = child.snapshot();
  }

  const snap: Snapshot<C> = { path, context, regions: regionSnapshots };

  if (options.payload !== undefined) {
    snap.payload = options.payload;
  }
  if (stateRef.isFinal) {
    snap.done = true;
  }
  if (options.error !== undefined) {
    snap.error = options.error;
  }

  return snap;
}
