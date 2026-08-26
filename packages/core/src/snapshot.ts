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
    /**
     * `error.context` points at the live actor context. Hand out a copy so a
     * subscriber cannot mutate internal state (see issue #226). `state` and
     * `event` are read-only handles and are left by reference
     */
    snap.error = { ...options.error, context: cloneValue(options.error.context) };
  }

  return snap;
}

/**
 * Deep-clones a plain-data value, used to hand subscribers copies of actor
 * context (issue #226). Prefers the structured-clone global and falls back to
 * a JSON round-trip for environments without it. Actor contexts are expected
 * to be serializable state-machine data
 */
export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
