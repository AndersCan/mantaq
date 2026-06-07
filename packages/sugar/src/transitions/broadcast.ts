export interface SendableMap<
  T extends { id: string; [key: string]: unknown } = { id: string; [key: string]: unknown },
> {
  keys(): string[];
  send(key: string, event: T): void;
}

export function broadcast<const T extends { id: string; [key: string]: unknown }>(
  map: SendableMap<T>,
  event: T,
): void {
  for (const key of map.keys()) {
    map.send(key, event);
  }
}
