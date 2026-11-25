import type { AnyActor, Machine } from "@mantaq/core";
import { isMachine } from "./is-machine.ts";

/** A state that runs another machine through the `embed` helper of `@mantaq/sugar`. */
export interface StateEmbed {
  /** State id as the diagram names it, with the region or part name in front. */
  state: string;
  machine: Machine;
  /** Inputs that the embed sends on to the child. Omitted = none. */
  forward?: string[];
}

interface StateEmbedsOptions {
  /** Put in front of each state name, such as `"upload."` for a region. Default: none. */
  prefix?: string;
}

/** What tools read from the `embedded` tag that `embed` puts on its effect fn. */
export interface EmbedTag {
  machine: Machine;
  /** Parent input types that embed sends on to the running child. */
  forward: string[];
  /** Parent internal event type that carries each child snapshot; undefined when the parent asks for none. */
  snapshot: string | undefined;
  /** Context field of the parent where its snapshot handler keeps the child snapshot; undefined when the parent does not say. */
  keep: string | undefined;
  /** The child running now; undefined when none is, or when the tag has no `running`. */
  running: () => unknown;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === "string");
}

/** The `embedded` tag of an effect entry; undefined when the entry is not an embed effect. */
export function embedTagOf(entry: unknown): EmbedTag | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const effect: unknown = Reflect.get(entry, "fn");
  if (typeof effect !== "function") return undefined;
  const tag: unknown = Reflect.get(effect, "embedded");
  if (typeof tag !== "object" || tag === null) return undefined;
  const machine: unknown = Reflect.get(tag, "machine");
  if (!isMachine(machine)) return undefined;
  const forward: unknown = Reflect.get(tag, "forward");
  const snapshot: unknown = Reflect.get(tag, "snapshot");
  const keep: unknown = Reflect.get(tag, "keep");
  const running: unknown = Reflect.get(tag, "running");
  return {
    machine,
    forward: isStringList(forward) ? forward : [],
    snapshot: typeof snapshot === "string" ? snapshot : undefined,
    keep: typeof keep === "string" ? keep : undefined,
    running: () => (typeof running === "function" ? Reflect.apply(running, tag, []) : undefined),
  };
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
      const tag = embedTagOf(entry);
      if (tag === undefined) continue;
      const forward = tag.forward.length === 0 ? {} : { forward: [...tag.forward] };
      found.push({ state: `${prefix}${state}`, machine: tag.machine, ...forward });
    }
  }
  return found;
}
