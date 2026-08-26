import { parseEventRefs } from "./parse-refs.ts";
import { event, EventRef } from "@mantaq/core";

export function events<T extends string>(...names: T[]): { [K in T]: EventRef<K> } {
  const result: Record<string, EventRef<T>> = {};
  for (const name of names) {
    result[name] = event(name)();
  }
  return parseEventRefs(result);
}
