import { state, StateRef } from "@mantaq/core";

export function states<T extends string>(...names: T[]): { [K in T]: StateRef<K> } {
  const result = {} as { [K in T]: StateRef<K> };
  for (const name of names) {
    result[name] = state(name)();
  }
  return result;
}
