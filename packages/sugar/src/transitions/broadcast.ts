export interface SendableMap {
  keys(): string[];
  send(key: string, event: unknown): void;
}

export function broadcast(map: SendableMap, event: { id: string; [key: string]: unknown }): void {
  for (const key of map.keys()) {
    map.send(key, event);
  }
}
