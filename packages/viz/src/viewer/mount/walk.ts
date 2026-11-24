import { decodeLiveSteps, encodeLiveStep } from "../../moves.ts";
import type { VizDriver, VizLiveState, VizLiveStep, VizMachine, VizStep } from "../../schema.ts";
import { encodePayloads } from "../send/payloads.ts";
import type { ViewerOptions } from "./viewer-options.ts";
import type { ViewState } from "./view-state.ts";

export interface RewindOptions {
  driver: VizDriver | undefined;
  length: number;
}

export function rewindView(view: ViewState, options: RewindOptions): void {
  const keep = Math.max(0, options.length);
  if (options.driver !== undefined && view.live !== null) {
    replayInto(view, { driver: options.driver, steps: view.live.steps.slice(0, keep) });
  }
}

export interface OpenInitialOptions {
  machine: VizMachine | undefined;
  driver: VizDriver | undefined;
  options: ViewerOptions;
}

/** Opens on the named run when it can replay, else on the start with a notice; with no run, on `steps`. */
export function openInitial(view: ViewState, context: OpenInitialOptions): void {
  const { machine, driver, options } = context;
  if (options.run === undefined || machine === undefined) {
    if (driver !== undefined) {
      replayInto(view, { driver, steps: decodeLiveSteps(options.steps ?? []) });
    }
    return;
  }
  const found = machine.runs.find((candidate) => candidate.name === options.run);
  if (found !== undefined && driver !== undefined) {
    replayInto(view, { driver, steps: found.steps });
    return;
  }
  if (driver !== undefined) replayInto(view, { driver, steps: [] });
  view.notice = runNotice(machine, { name: options.run, found: found !== undefined });
}

interface RunNoticeOptions {
  name: string;
  found: boolean;
}

function runNotice(machine: VizMachine, run: RunNoticeOptions): string {
  if (run.found) return `Run "${run.name}" replays only when ${machine.id} runs live.`;
  if (machine.runs.length === 0) {
    return `No run named "${run.name}" in ${machine.id}; it has no recorded runs.`;
  }
  const names: string[] = [];
  for (const candidate of machine.runs) names.push(candidate.name);
  const listed = names.join(", ");
  return `No run named "${run.name}" in ${machine.id}. Runs: ${listed}`;
}

export interface WatchDriverOptions {
  driver: VizDriver | undefined;
  redraw: () => void;
}

/** An effect result that arrives later replaces the live state. */
export function watchDriver(view: ViewState, context: WatchDriverOptions): void {
  context.driver?.listen?.((state) => {
    view.live = state;
    if (view.afters.length > 0 && view.afters.length === state.steps.length) {
      view.afters[view.afters.length - 1] = state.after;
      if (state.last !== null) view.lasts[view.lasts.length - 1] = state.last;
    }
    context.redraw();
  });
}

export interface NavigatedOptions {
  machine: VizMachine;
  view: ViewState;
}

/** Tells the host where the walk and the changed payloads now are. */
export function navigated(options: ViewerOptions, now: NavigatedOptions): void {
  const { machine, view } = now;
  options.onNavigate?.({
    machine: machine.id,
    steps: view.live?.steps.map(encodeLiveStep) ?? [],
    payloads: encodePayloads(view.payloads),
  });
}

export interface StepIntoOptions {
  driver: VizDriver;
  step: VizStep;
}

/** Takes one live step. */
export function stepInto(view: ViewState, options: StepIntoOptions): void {
  const length = view.live?.steps.length ?? 0;
  view.live = stepSafely(options.driver, { before: view.live, step: options.step });
  if (view.live.steps.length === length + 1) {
    view.afters.push(view.live.after);
    view.lasts.push(view.live.last);
  }
}

interface ReplayOptions {
  driver: VizDriver;
  steps: ReadonlyArray<VizStep>;
}

/** Sets `view.live` to the state after `steps`. */
function replayInto(view: ViewState, options: ReplayOptions): void {
  const played = replay(options);
  view.live = played.live;
  view.afters = played.afters;
  view.lasts = played.lasts;
}

interface StepSafelyOptions {
  before: VizLiveState | null;
  step: VizStep;
}

/** A driver that throws leaves the state where it was and shows the message as a handler error. */
function stepSafely(driver: VizDriver, context: StepSafelyOptions): VizLiveState {
  const { before, step } = context;
  try {
    return driver.step(step);
  } catch (error: unknown) {
    if (before === null) throw error;
    return {
      ...before,
      last: {
        from: before.state,
        event: step.kind === "event" ? step.event : step.kind,
        to: before.state,
        outcome: "stay",
        effects: [],
        context: before.context,
        sent: [],
        error: error instanceof Error ? error.message : String(error),
      },
      after: before.after,
    };
  }
}

interface Replayed {
  live: VizLiveState;
  afters: VizLiveStep[][];
  lasts: Array<VizLiveStep | null>;
}

/** Back is reset plus replay: the driver keeps no history. Stops at the first step the driver throws on. */
function replay(options: ReplayOptions): Replayed {
  const { driver, steps } = options;
  let live = driver.reset();
  const afters: VizLiveStep[][] = [];
  const lasts: Array<VizLiveStep | null> = [];
  for (const step of steps) {
    const length = live.steps.length;
    live = stepSafely(driver, { before: live, step });
    if (live.steps.length === length + 1) {
      afters.push(live.after);
      lasts.push(live.last);
    }
    if (live.last?.error) return { live, afters, lasts };
  }
  return { live, afters, lasts };
}
