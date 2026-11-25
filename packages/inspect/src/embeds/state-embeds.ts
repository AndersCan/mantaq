import type { AnyActor, Machine } from "@mantaq/core";
import { isMachine } from "./is-machine.ts";

/** A state that runs another machine through the `embed` helper of `@mantaq/sugar`. */
export interface StateEmbed {
  /** State id as the diagram names it, with the region or part name in front. */
  state: string;
  machine: Machine;
}

interface StateEmbedsOptions {
  /** Put in front of each state name, such as `"upload."` for a region. Default: none. */
  prefix?: string;
}

/** The machine in the `embedded` tag that `embed` puts on its effect fn; the other tag fields are not read. */
function embeddedMachine(entry: unknown): Machine | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const effect: unknown = Reflect.get(entry, "fn");
  if (typeof effect !== "function") return undefined;
  const tag: unknown = Reflect.get(effect, "embedded");
  if (typeof tag !== "object" || tag === null) return undefined;
  const machine: unknown = Reflect.get(tag, "machine");
  return isMachine(machine) ? machine : undefined;
}

/** Every embed effect of the actor itself, in state order then registration order. Regions and parts are not read. */
export function stateEmbeds(
  actor: AnyActor<unknown>,
  options: StateEmbedsOptions = {},
): StateEmbed[] {
  const prefix = options.prefix ?? "";
  const found: StateEmbed[] = [];
  for (const [state, entries] of Object.entries(actor.options?.effects ?? {})) {
    for (const entry of entries) {
      const machine = embeddedMachine(entry);
      if (machine !== undefined) found.push({ state: `${prefix}${state}`, machine });
    }
  }
  return found;
}
