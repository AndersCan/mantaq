import { partMachine, partName, partsOf } from "../parts.ts";
import type { VizDocument, VizMachine } from "../../schema.ts";
import type { EnteredMachine } from "../graph.ts";
import { isNever } from "../../is-never.ts";

/** One step in from the root: open one machine of a board, or enter the machine a state embeds. */
export type FocusStep =
  | { kind: "part"; part: string; name: string }
  | { kind: "enter"; state: string };

/** A crumb of the path: its label and how many steps a click on it keeps. */
export interface Crumb {
  label: string;
  keep: number;
}

/** What a focus path shows, resolved against the document. */
export interface Focus {
  /** The steps that resolve, in order; the rest of a path is dropped. */
  steps: FocusStep[];
  /** The root machine, then each machine entered, with the state it was entered from. */
  machines: Array<{ machine: VizMachine; state?: string }>;
  /** Board: the boxes of `machine`. Graph: `drawn`, drawn whole. */
  canvas: "board" | "graph";
  /** The deepest machine: the root, or the last one entered. */
  machine: VizMachine;
  /** The machine the canvas draws: `machine`, or one machine of its board. */
  drawn: VizMachine;
  /** The board machine shown alone (`""` for the machine's own); undefined when none is. */
  part: string | undefined;
  /** The root's live state is drawn only at the root; an entered machine is drawn static. */
  walk: "live" | "static";
  /** The root's machine shown alone while the root is shown; undefined otherwise. */
  rootPart: string | undefined;
  crumbs: Crumb[];
}

interface Level {
  machine: VizMachine;
  part: string | undefined;
}

function drawnOf(level: Level): VizMachine {
  return level.part === undefined ? level.machine : partMachine(level.machine, level.part);
}

function isBoard(level: Level): boolean {
  return partsOf(level.machine).length > 0 && level.part === undefined;
}

interface EmbeddedOptions {
  viz: VizDocument;
  state: string;
}

/** The machine a state of the level's drawing embeds; undefined when it embeds none or the document lacks it. */
function embedded(level: Level, options: EmbeddedOptions): VizMachine | undefined {
  const state = drawnOf(level).states.find((candidate) => candidate.id === options.state);
  if (state?.machine === undefined) return undefined;
  return options.viz.machines.find((machine) => machine.id === state.machine);
}

export interface FocusOptions {
  viz: VizDocument;
  root: VizMachine;
}

/** Walks `steps` from the root; the first step that does not resolve ends the path. */
export function focusOf(steps: ReadonlyArray<FocusStep>, options: FocusOptions): Focus {
  const { viz, root } = options;
  let level: Level = { machine: root, part: undefined };
  const kept: FocusStep[] = [];
  const machines: Focus["machines"] = [{ machine: root }];
  const crumbs: Crumb[] = [{ label: root.id, keep: 0 }];
  for (const step of steps) {
    const next = stepInto(level, { viz, step });
    if (next === undefined) break;
    kept.push(next.step);
    crumbs.push({ label: next.label, keep: kept.length });
    if (step.kind === "enter") machines.push({ machine: next.level.machine, state: step.state });
    level = next.level;
  }
  const entered = machines.length > 1;
  return {
    steps: kept,
    machines,
    canvas: isBoard(level) ? "board" : "graph",
    machine: level.machine,
    drawn: drawnOf(level),
    part: level.part,
    walk: entered ? "static" : "live",
    rootPart: entered ? undefined : level.part,
    crumbs,
  };
}

interface Stepped {
  level: Level;
  step: FocusStep;
  label: string;
}

interface StepIntoOptions {
  viz: VizDocument;
  step: FocusStep;
}

function stepInto(level: Level, options: StepIntoOptions): Stepped | undefined {
  const { step } = options;
  switch (step.kind) {
    case "part": {
      if (!isBoard(level) || !partsOf(level.machine).includes(step.part)) return undefined;
      const name = partName(level.machine, step.part);
      const part = { kind: "part", part: step.part, name } as const;
      return { level: { machine: level.machine, part: step.part }, step: part, label: name };
    }
    case "enter": {
      if (isBoard(level)) return undefined;
      const machine = embedded(level, { viz: options.viz, state: step.state });
      if (machine === undefined) return undefined;
      return { level: { machine, part: undefined }, step, label: machine.id };
    }
    default:
      return isNever(step);
  }
}

/** The steps the address bar names: on a board a machine's name, else a state that embeds a machine. */
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

function stepOf(token: string, focus: Focus): FocusStep | undefined {
  if (focus.canvas === "graph") return { kind: "enter", state: token };
  const { machine } = focus;
  if (machine.actors.includes(token)) return { kind: "part", part: token, name: token };
  return token === machine.id ? { kind: "part", part: "", name: token } : undefined;
}

/** The address-bar value of each step (`?focus=`): a machine's name on a board, else the state entered from. */
export function focusTokens(steps: ReadonlyArray<FocusStep>): string[] {
  const tokens: string[] = [];
  for (const step of steps) tokens.push(step.kind === "part" ? step.name : step.state);
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

/** The machine a viewer opens on by default: the first that no other machine embeds. */
export function startOf(viz: VizDocument): VizMachine | undefined {
  const embeddedIds = new Set<string>();
  for (const machine of viz.machines) {
    for (const state of machine.states) {
      if (state.machine !== undefined) embeddedIds.add(state.machine);
    }
  }
  return viz.machines.find((machine) => !embeddedIds.has(machine.id)) ?? viz.machines[0];
}

/** A move along the focus path: what was shown, and what is shown now. */
export interface FocusMove {
  before: Focus;
  after: Focus;
}

/** The machine a move entered and the state it entered from; undefined for any other move. */
export function enteredBy(move: FocusMove): EnteredMachine | undefined {
  const { before, after } = move;
  const step = after.steps.at(-1);
  if (after.steps.length <= before.steps.length || step?.kind !== "enter") return undefined;
  return { machine: after.machine.id, state: step.state };
}
