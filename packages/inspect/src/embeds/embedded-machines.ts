import { Either } from "@mantaq/utils";
import type { Machine } from "@mantaq/core";
import type { StateEmbed } from "./state-embeds.ts";
import type { VizMachine } from "@mantaq/viz";

/** How many machines deep the walk follows embeds below a root. */
export const EMBED_DEPTH = 8;

/** A drawn machine and the embeds of its states, in the order `stateEmbeds` found them. */
export interface Embedding {
  machine: VizMachine;
  embeds: ReadonlyArray<StateEmbed>;
}

/** A machine the walk built, with what it is worth knowing about it, without its id in front. */
export interface BuiltEmbedding extends Embedding {
  warnings: ReadonlyArray<string>;
}

interface WalkOptions {
  /** Draws a machine that no root is; a left says why it could not be drawn. */
  build: (machine: Machine) => Either<string, BuiltEmbedding>;
}

export interface EmbeddedMachines {
  /** The roots in their order, each without the references the walk dropped. */
  roots: VizMachine[];
  /** Each machine the roots embed that no root is, once, in the order the walk first reached it. */
  embedded: VizMachine[];
  /** Each line starts with the id of the machine it is about. */
  warnings: string[];
}

interface Walk {
  build: WalkOptions["build"];
  rootsById: ReadonlyMap<string, Embedding>;
  drawnIds: Set<string>;
  open: Set<string>;
  failed: Map<string, string>;
  drawnRoots: Map<Embedding, VizMachine>;
  drawnEmbedded: Map<string, VizMachine>;
  warnings: string[];
}

interface Followed {
  machine: Machine;
  depth: number;
}

interface Dropped {
  /** State ids whose `machine` goes. */
  states: ReadonlySet<string>;
}

function withoutReferences(machine: VizMachine, options: Dropped): VizMachine {
  if (options.states.size === 0) return machine;
  const kept = [];
  for (const state of machine.states) {
    const copy = { ...state };
    if (options.states.has(state.id)) delete copy.machine;
    kept.push(copy);
  }
  return { ...machine, states: kept };
}

/** Puts the embedded machine in the document, or says why the reference to it must go. */
function follow(walk: Walk, followed: Followed): string | undefined {
  const { machine, depth } = followed;
  if (walk.open.has(machine.id)) {
    return `that is a cycle: ${machine.id} embeds this machine, directly or through others`;
  }
  if (walk.drawnIds.has(machine.id)) return undefined;
  const failure = walk.failed.get(machine.id);
  if (failure !== undefined) return failure;
  const root = walk.rootsById.get(machine.id);
  if (root !== undefined) {
    drawRoot(walk, root);
    return undefined;
  }
  if (depth > EMBED_DEPTH) return `it is more than ${EMBED_DEPTH} machines deep`;
  const built = walk.build(machine);
  if (Either.isLeft(built)) {
    const reason = `it could not be built: ${built[0]}`;
    walk.failed.set(machine.id, reason);
    return reason;
  }
  for (const warning of built[1].warnings) walk.warnings.push(`${machine.id}: ${warning}`);
  walk.drawnIds.add(machine.id);
  // Set before the visit, so the machine keeps the place where the walk first reached it.
  walk.drawnEmbedded.set(machine.id, built[1].machine);
  walk.drawnEmbedded.set(machine.id, visit(walk, { node: built[1], depth }));
  return undefined;
}

interface Visit {
  node: Embedding;
  depth: number;
}

/** The machine with every embed of its states followed, without the references the walk could not keep. */
function visit(walk: Walk, options: Visit): VizMachine {
  const { node, depth } = options;
  const id = node.machine.id;
  walk.open.add(id);
  const shown = new Map<string, string>();
  const dropped = new Set<string>();
  for (const embed of node.embeds) {
    const first = shown.get(embed.state);
    if (first !== undefined) {
      walk.warnings.push(
        `${id}: ${embed.state} embeds ${first} and ${embed.machine.id}; the diagram shows only ${first}`,
      );
      continue;
    }
    shown.set(embed.state, embed.machine.id);
    const reason = follow(walk, { machine: embed.machine, depth: depth + 1 });
    if (reason === undefined) continue;
    dropped.add(embed.state);
    walk.warnings.push(`${id}: ${embed.state} embeds ${embed.machine.id}, not drawn: ${reason}`);
  }
  walk.open.delete(id);
  return withoutReferences(node.machine, { states: dropped });
}

function drawRoot(walk: Walk, root: Embedding): void {
  walk.drawnIds.add(root.machine.id);
  walk.drawnRoots.set(root, visit(walk, { node: root, depth: 0 }));
}

/**
 * The roots and every machine their states embed, each id drawn once: a root wins over a built
 * copy. A reference that closes a cycle, goes past `EMBED_DEPTH` or names a machine that cannot
 * be built is dropped with a warning, so the document validates.
 */
export function withEmbedded(
  roots: ReadonlyArray<Embedding>,
  options: WalkOptions,
): EmbeddedMachines {
  const rootsById = new Map<string, Embedding>();
  for (const root of roots) {
    if (!rootsById.has(root.machine.id)) rootsById.set(root.machine.id, root);
  }
  const walk: Walk = {
    build: options.build,
    rootsById,
    drawnIds: new Set(),
    open: new Set(),
    failed: new Map(),
    drawnRoots: new Map(),
    drawnEmbedded: new Map(),
    warnings: [],
  };
  for (const root of roots) {
    if (!walk.drawnRoots.has(root)) drawRoot(walk, root);
  }
  const drawn = [];
  for (const root of roots) drawn.push(walk.drawnRoots.get(root) ?? root.machine);
  return { roots: drawn, embedded: [...walk.drawnEmbedded.values()], warnings: walk.warnings };
}
