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

/** True when `effect` is an embed effect: holding it would leave no child to forward events to. */
export function isEmbedEffect(effect: unknown): boolean {
  return embedTagOf(effect) !== undefined;
}

/** The state name a snapshot holds; undefined when the value is not a snapshot. */
function snapshotState(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const path: unknown = Reflect.get(value, "path");
  if (!Array.isArray(path)) return undefined;
  const [name]: unknown[] = path;
  return typeof name === "string" ? name : undefined;
}

interface KeptOptions {
  actor: AnyActor<unknown>;
  tag: EmbedTag;
}

/** The child state in the context field that the tag's `keep` names; undefined without `keep`. */
function keptState(options: KeptOptions): string | undefined {
  const { actor, tag } = options;
  if (tag.keep === undefined) return undefined;
  const context: unknown = actor.snapshot().context;
  if (typeof context !== "object" || context === null) return undefined;
  return snapshotState(Reflect.get(context, tag.keep));
}

/**
 * The embeds of `parts` whose state is current. Each child state comes from the parent's context field
 * that the embed's `keep` names, so it is what the parent's own snapshot holds.
 */
export function runningEmbeds(parts: ReadonlyArray<EmbedPart>): VizLiveEmbed[] {
  const running: VizLiveEmbed[] = [];
  for (const { actor, prefix } of parts) {
    const local = actor.state.name;
    for (const entry of actor.options?.effects?.[local] ?? []) {
      const tag = embedTagOf(entry);
      if (tag === undefined) continue;
      const current = keptState({ actor, tag });
      running.push({
        state: `${prefix}${local}`,
        machine: tag.machine.id,
        forward: [...tag.forward],
        ...(current === undefined ? {} : { current }),
      });
    }
  }
  return running;
}
