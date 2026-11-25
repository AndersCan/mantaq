import type { AnyActor } from "@mantaq/core";
import type { EmbedTag } from "./state-embeds.ts";
import { embedTagOf } from "./state-embeds.ts";
import type { VizLiveEmbed } from "@mantaq/viz";

/** A part of the running machine whose states can embed machines: the machine itself, a region, or a returned machine. */
export interface EmbedPart {
  actor: AnyActor<unknown>;
  /** Put in front of each state name, such as `"upload."` for a region; `""` for the machine itself. */
  prefix: string;
}

/** True for an embed effect that forwards inputs or keeps its child snapshot: holding it would leave no child to forward to or to show. */
export function drivesChild(effect: unknown): boolean {
  const tag = embedTagOf(effect);
  return tag !== undefined && (tag.forward.length > 0 || tag.keep !== undefined);
}

/** What a kept child snapshot says: the child's state and whether it ended. */
interface KeptChild {
  state: string;
  done: boolean;
}

/** The state a snapshot holds; undefined when the value is not a snapshot. */
function keptChild(value: unknown): KeptChild | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const path: unknown = Reflect.get(value, "path");
  if (!Array.isArray(path)) return undefined;
  const [name]: unknown[] = path;
  const done = Reflect.get(value, "done") === true;
  return typeof name === "string" ? { state: name, done } : undefined;
}

interface KeptOptions {
  actor: AnyActor<unknown>;
  tag: EmbedTag;
}

/** The child in the context field that the tag's `keep` names; undefined without `keep`. */
function keptOf(options: KeptOptions): KeptChild | undefined {
  const { actor, tag } = options;
  if (tag.keep === undefined) return undefined;
  const context: unknown = actor.snapshot().context;
  if (typeof context !== "object" || context === null) return undefined;
  return keptChild(Reflect.get(context, tag.keep));
}

/** The first embed of a state, as the diagram draws it: a state names one machine. */
function firstTag(entries: ReadonlyArray<unknown>): EmbedTag | undefined {
  for (const entry of entries) {
    const tag = embedTagOf(entry);
    if (tag !== undefined) return tag;
  }
  return undefined;
}

/**
 * The embeds of the current states of `parts`, leaving out a child that ended. Each child state comes from
 * the parent's context field that the embed's `keep` names, so it is what the parent's own snapshot holds.
 */
export function runningEmbeds(parts: ReadonlyArray<EmbedPart>): VizLiveEmbed[] {
  const running: VizLiveEmbed[] = [];
  for (const { actor, prefix } of parts) {
    const local = actor.state.name;
    const tag = firstTag(actor.options?.effects?.[local] ?? []);
    const kept = tag === undefined ? undefined : keptOf({ actor, tag });
    if (tag === undefined || kept?.done === true) continue;
    running.push({
      state: `${prefix}${local}`,
      ...(kept === undefined ? {} : { current: kept.state }),
    });
  }
  return running;
}
