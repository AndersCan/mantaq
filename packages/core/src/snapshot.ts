import type { AnyStateRef } from "./state.ts";
import type { ErrorInfo, Snapshot } from "./actor-types.ts";

export function buildSnapshot<C>(
  s: AnyStateRef,
  regions: Record<string, { snapshot(): Snapshot }>,
  context: C,
  opts: { error?: ErrorInfo; payload?: unknown } = {},
): Snapshot<C> {
  const path = [s.name];
  const regionSnapshots: Record<string, Snapshot> = {};

  for (const [regionName, child] of Object.entries(regions))
    regionSnapshots[regionName] = child.snapshot();

  const snap: Snapshot<C> = { path, context, regions: regionSnapshots };

  if (opts.payload !== undefined) snap.payload = opts.payload;
  if (s.isFinal) snap.done = true;
  if (opts.error !== undefined) snap.error = opts.error;

  return snap;
}
