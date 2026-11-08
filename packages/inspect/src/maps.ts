/** What the inspector needs from a sugar actor map. Browser-safe: no node imports. */
export interface ActorMapLike {
  keys(): string[];
  get(key: string): unknown;
  spawn(key: string): void;
  ensure(key: string): void;
  kill(key: string): void;
  snapshot(key: string): unknown;
  dispose(): void;
}

function hasFunctions(value: unknown, names: ReadonlyArray<string>): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    names.every((name) => typeof Reflect.get(value, name) === "function")
  );
}

function isMapLike(value: unknown): value is ActorMapLike {
  return hasFunctions(value, ["keys", "get", "spawn", "ensure", "kill", "snapshot", "dispose"]);
}

function isOldMap(value: unknown): boolean {
  return (
    hasFunctions(value, ["keys", "spawn", "snapshot", "send"]) &&
    typeof Reflect.get(value as object, "get") !== "function"
  );
}

/**
 * The actor maps a factory returned next to its actor: own enumerable
 * properties except `actor`, sorted by name. `old` names maps from a sugar
 * version without `get`.
 */
export function actorMapsOf(made: unknown): { maps: Record<string, ActorMapLike>; old: string[] } {
  if (typeof made !== "object" || made === null) return { maps: {}, old: [] };
  const names = Object.keys(made)
    .filter((name) => name !== "actor")
    .sort();
  const value = (name: string): unknown => Reflect.get(made, name);
  return {
    maps: Object.fromEntries(
      names
        .filter((name) => isMapLike(value(name)))
        .map((name) => [name, value(name) as ActorMapLike]),
    ),
    old: names.filter((name) => isOldMap(value(name))),
  };
}
