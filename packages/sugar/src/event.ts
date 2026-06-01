import { event, EventRef } from "@mantaq/core";

export function events<T extends string>(...names: T[]): { [K in T]: EventRef<K> } {
  const result = {} as { [K in T]: EventRef<K> };
  for (const name of names) {
    result[name] = event(name)();
  }
  return result;
}
