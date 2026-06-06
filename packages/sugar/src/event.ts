import { event, EventRef } from "core";

export function events<T extends string>(...names: T[]): { [K in T]: EventRef<K> } {
  const result = {} as { [K in T]: EventRef<K> };
  for (const name of names) {
    // @ts-expect-error: dynamic assignment to mapped type
    result[name] = event(name)();
  }
  return result;
}
