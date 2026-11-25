import { enteredGroupOf, groupMachine } from "../groups/group-machine.ts";
import { foldGroups, groupNodesOf } from "../groups/fold-groups.ts";
import { partMachine, partName, partsOf } from "../parts.ts";
import type { EnteredGroup } from "../graph.ts";
import { isNever } from "../../is-never.ts";
import type { VizMachine } from "../../schema.ts";

/** One step in from the root: open one machine of a board, or enter a group of the machine drawn. */
export type FocusStep =
  | { kind: "part"; part: string; name: string }
  | { kind: "enter"; node: string; name: string };

/** A crumb of the path: its label and how many steps a click on it keeps. */
interface Crumb {
  label: string;
  keep: number;
}

/** What a focus path shows, resolved against the document. */
export interface Focus {
  /** The steps that resolve, in order; the rest of a path is dropped. */
  steps: FocusStep[];
  /** Board: the boxes of `machine`. Graph: `drawn`, drawn whole. */
  canvas: "board" | "graph";
  /** The machine the viewer walks. */
  machine: VizMachine;
  /** What the canvas draws: `machine` or one machine of its board, with each group folded into one node, or the group entered. */
  drawn: VizMachine;
  /** The board machine shown alone (`""` for the machine's own); undefined when none is. */
  part: string | undefined;
  /** The id of the group node entered (`@payment`); undefined when none is. */
  groupNode: string | undefined;
  crumbs: Crumb[];
}

interface Level {
  machine: VizMachine;
  part: string | undefined;
  groupNode: string | undefined;
}

/** The machine or the one board machine a level draws, before groups fold. */
function cutOf(level: Level): VizMachine {
  const { machine, part } = level;
  return part === undefined ? machine : partMachine(machine, part);
}

/** What the canvas draws for a level: the group entered, or the cut with each group folded into one node. */
function drawnOf(level: Level): VizMachine {
  const cut = cutOf(level);
  const { groupNode } = level;
  const entered = groupNode === undefined ? undefined : groupMachine(cut, { group: groupNode });
  return entered ?? foldGroups(cut);
}

function isBoard(level: Level): boolean {
  return partsOf(level.machine).length > 0 && level.part === undefined;
}

export interface FocusOptions {
  root: VizMachine;
}

/** Walks `steps` from the root; the first step that does not resolve ends the path. */
export function focusOf(steps: ReadonlyArray<FocusStep>, options: FocusOptions): Focus {
  const { root } = options;
  let level: Level = { machine: root, part: undefined, groupNode: undefined };
  const kept: FocusStep[] = [];
  const crumbs: Crumb[] = [{ label: root.id, keep: 0 }];
  for (const step of steps) {
    const next = stepInto(level, step);
    if (next === undefined) break;
    kept.push(next.step);
    crumbs.push({ label: next.step.name, keep: kept.length });
    level = next.level;
  }
  return {
    steps: kept,
    canvas: isBoard(level) ? "board" : "graph",
    machine: level.machine,
    drawn: drawnOf(level),
    part: level.part,
    groupNode: level.groupNode,
    crumbs,
  };
}

interface Stepped {
  level: Level;
  step: FocusStep;
}

function stepInto(level: Level, step: FocusStep): Stepped | undefined {
  switch (step.kind) {
    case "part": {
      if (!isBoard(level) || !partsOf(level.machine).includes(step.part)) return undefined;
      const name = partName(level.machine, step.part);
      const part = { kind: "part", part: step.part, name } as const;
      return { level: { ...level, part: step.part }, step: part };
    }
    case "enter": {
      if (isBoard(level) || level.groupNode !== undefined) return undefined;
      const cut = cutOf(level);
      const scoped = level.part ? `${level.part}.${step.node}` : step.node;
      const view = groupMachine(cut, { group: step.node }) ?? groupMachine(cut, { group: scoped });
      const node = view === undefined ? undefined : enteredGroupOf(view);
      if (node === undefined) return undefined;
      const entered = { kind: "enter", node: node.id, name: node.name } as const;
      return { level: { ...level, groupNode: node.id }, step: entered };
    }
    default:
      return isNever(step);
  }
}

/** The steps the address bar names: on a board a machine's name, else a group node's id. */
export function decodeFocus(tokens: ReadonlyArray<string>, options: FocusOptions): FocusStep[] {
  const steps: FocusStep[] = [];
  for (const token of tokens) {
    const level = focusOf(steps, options);
    const step = stepOf(token, level);
    if (step === undefined) break;
    steps.push(step);
  }
  return focusOf(steps, options).steps;
}

/** What the bar says when a link's path names a machine or a group that is not there; undefined when the whole path resolves. */
export function unknownFocusText(
  tokens: ReadonlyArray<string>,
  options: FocusOptions,
): string | undefined {
  const steps = decodeFocus(tokens, options);
  const token = tokens[steps.length];
  if (token === undefined) return undefined;
  const focus = focusOf(steps, options);
  const here = focus.crumbs.at(-1)?.label ?? options.root.id;
  const kind = focus.canvas === "board" ? "machine" : "group";
  const said = `No ${kind} "${token}" in ${here}. The link opens ${here}.`;
  const named = namesHere(focus);
  if (named.length === 0) return said;
  const listed = named.join(", ");
  const these = kind === "machine" ? "Machines" : "Groups";
  return `${said} ${these} here: ${listed}.`;
}

/** What a link's next step can name at this level: the machines of a board, or the group nodes of the machine drawn. */
function namesHere(focus: Focus): string[] {
  if (focus.canvas === "board") {
    return partsOf(focus.machine).map((part) => partName(focus.machine, part));
  }
  if (focus.groupNode !== undefined) return [];
  const names: string[] = [];
  for (const node of groupNodesOf(focus.drawn)) names.push(node.id);
  return names;
}

function stepOf(token: string, focus: Focus): FocusStep | undefined {
  if (focus.canvas === "graph") return { kind: "enter", node: token, name: token };
  const { machine } = focus;
  if (machine.actors.includes(token)) return { kind: "part", part: token, name: token };
  return token === machine.id ? { kind: "part", part: "", name: token } : undefined;
}

/** The address-bar value of each step (`?focus=`): a machine's name on a board, else the group node entered. */
export function focusTokens(steps: ReadonlyArray<FocusStep>): string[] {
  const tokens: string[] = [];
  for (const step of steps) tokens.push(step.kind === "part" ? step.name : step.node);
  return tokens;
}

/** What holds the path: the viewer's state. */
export interface Focused {
  focus: FocusStep[];
}

/** The view's focus resolved; worked out again only when `view.focus` is replaced. */
export function focusReader(view: Focused, options: FocusOptions): () => Focus {
  let resolved = focusOf(view.focus, options);
  view.focus = resolved.steps;
  return () => {
    if (resolved.steps !== view.focus) {
      resolved = focusOf(view.focus, options);
      view.focus = resolved.steps;
    }
    return resolved;
  };
}

/** A move along the focus path: what was shown, and what is shown now. */
export interface FocusMove {
  before: Focus;
  after: Focus;
}

/** The group a move entered; undefined for any other move. */
export function enteredBy(move: FocusMove): EnteredGroup | undefined {
  const { before, after } = move;
  const step = after.steps.at(-1);
  if (after.steps.length <= before.steps.length || step?.kind !== "enter") return undefined;
  return { node: step.node, name: step.name };
}
