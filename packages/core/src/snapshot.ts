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

  for (const [regionName, child] of Object.entries(regions)) {
    regionSnapshots[regionName] = child.snapshot();
  }

  const snap: Snapshot<C> = { path, context, regions: regionSnapshots };

  if (opts.payload !== undefined) {
    snap.payload = opts.payload;
  }
  if (s.isFinal) {
    snap.done = true;
  }
  if (opts.error !== undefined) {
    // `error.context` points at the live actor context; hand out a copy so a
    // subscriber cannot mutate internal state (see issue #226). `state`/`event`
    // are read-only handles and are left by reference.
    snap.error = { ...opts.error, context: cloneValue(opts.error.context) };
  }

  return snap;
}

/**
 * Deep-clones a plain-data value, used to hand subscribers copies of actor
 * context (issue #226). Prefers the structured-clone global; falls back to a
 * JSON round-trip for environments without it. Actor contexts are expected to
 * be serializable state-machine data.
 */
export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
