import { parseStateRefs } from "./parse-refs.ts";
import { state, StateRef } from "@mantaq/core";

interface StatesEntry {
  name: string;
  final?: boolean;
}

type StatesArg = string | StatesEntry;

type NameOf<T> = T extends string ? T : T extends { name: infer N extends string } ? N : never;
type FinalOf<T> = T extends { final: true } ? true : false;

type StatesRecord<T extends StatesArg[]> = {
  [K in T[number] as NameOf<K>]: StateRef<NameOf<K>, unknown, FinalOf<K>>;
};

export function states<const T extends StatesArg[]>(...entries: T): StatesRecord<T> {
  const result: Record<string, StateRef<string, unknown, boolean>> = {};
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    const ref = state(name)();
    result[name] = typeof entry === "object" && entry.final ? ref.final() : ref;
  }
  return parseStateRefs<StatesRecord<T>>(result);
}
