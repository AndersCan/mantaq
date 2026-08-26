import type { AnyEventRef } from "@mantaq/core";

/**
 * Plain event shape sugar helpers accept next to core event refs.
 */
export type EventLike = { type: string; payload?: unknown };

/**
 * Anything sendable through sugar helpers — a core ref or a plain object.
 */
export type SendableEvent = AnyEventRef | EventLike;

export interface SendableMap<T extends SendableEvent = SendableEvent> {
  keys(): string[];
  send(key: string, ...events: [event: T]): void;
}

/**
 * Fan every given event out to all children of the map, once per key, in
 * key order.
 */
export function broadcast<const T extends SendableEvent>(
  map: SendableMap<T>,
  ...events: [event: T]
): void {
  for (const event of events) {
    for (const key of map.keys()) {
      map.send(key, event);
    }
  }
}
