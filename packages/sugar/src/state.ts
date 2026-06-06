import { state, StateRef } from "core";

export function states<T extends string>(...names: T[]): { [K in T]: StateRef<K> } {
  const result = {} as { [K in T]: StateRef<K> };
  for (const name of names) {
    // @ts-expect-error: dynamic assignment to mapped type
    result[name] = state(name)();
  }
  return result;
}
