import type { AnyEventRef } from "@mantaq/core";

export type EventLike = { id: string; [key: string]: unknown };

export type SendableEvent = AnyEventRef | EventLike;

export interface SendableMap<T extends SendableEvent = SendableEvent> {
  keys(): string[];
  send(key: string, event: T): void;
}

export function broadcast<const T extends SendableEvent>(map: SendableMap<T>, event: T): void {
  for (const key of map.keys()) {
    map.send(key, event);
  }
}
