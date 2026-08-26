/**
 * Parsing utilities that turn the loosely-typed AnyActor.options surface into
 * graph-shaped values. This is the single place where untyped input is
 * converted (per ts-strict-casting) and every other module consumes typed
 * results from here.
 */
import type { StateDef, TransitionDispatchMap, TransitionHandler } from "./types.ts";
import { isStateRef } from "@mantaq/core";

export function parseStates(options: unknown): ReadonlyArray<StateDef> {
  const states = (options as { states?: unknown } | undefined)?.states;
  if (!Array.isArray(states)) return [];
  return states.filter(
    (stateEntry): stateEntry is StateDef =>
      typeof stateEntry === "object" &&
      stateEntry !== null &&
      typeof (stateEntry as { name?: unknown }).name === "string" &&
      typeof (stateEntry as { isFinal?: unknown }).isFinal === "boolean",
  );
}

export function parseTransitionMap(source: unknown): TransitionDispatchMap {
  const dispatchMap: TransitionDispatchMap = {};
  if (typeof source !== "object" || source === null) return dispatchMap;
  for (const [stateName, eventMap] of Object.entries(source)) {
    if (typeof eventMap !== "object" || eventMap === null) continue;
    for (const [eventType, handler] of Object.entries(eventMap)) {
      if (typeof handler !== "function") continue;
      (dispatchMap[stateName] ??= {})[eventType] = handler as TransitionHandler;
    }
  }
  return dispatchMap;
}

export function parseInitialName(options: unknown): string | undefined {
  const initial = (options as { initial?: unknown } | undefined)?.initial;
  if (initial === undefined || initial === null) return undefined;
  if (isStateRef(initial)) return initial.name;
  const wrapped = initial as { state?: unknown };
  return isStateRef(wrapped.state) ? wrapped.state.name : undefined;
}

export function parseContextRecord(context: unknown): Record<string, unknown> {
  if (context === undefined || context === null) return {};
  return { ...(context as Record<string, unknown>) };
}

export function parseInternalEventIds(options: unknown): Set<string> {
  const internal = (options as { internal?: unknown } | undefined)?.internal;
  const eventIds = new Set<string>();
  if (!Array.isArray(internal)) return eventIds;
  for (const entry of internal) {
    if (typeof entry !== "object" || entry === null || !("type" in entry)) continue;
    const eventType = (entry as { type: unknown }).type;
    if (typeof eventType === "string") eventIds.add(eventType);
  }
  return eventIds;
}
