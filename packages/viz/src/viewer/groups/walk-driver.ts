import type { VizDriver, VizLiveState, VizLiveStep, VizMachine, VizStep } from "../../schema.ts";

export interface WalkOptions {
  /** Edges whose guard never lets the walk take them. */
  guarded: ReadonlySet<string>;
}

/** A hand-written driver that walks the machine's own edges: an event takes the first unguarded edge from the current state, or stays. */
export function walkDriver(machine: VizMachine, options: WalkOptions) {
  const sent: VizStep[] = [];
  let listener: ((state: VizLiveState) => void) | undefined;
  function stepFrom(state: string, step: VizStep): VizLiveStep {
    const event = step.kind === "event" ? step.event : "advance";
    const edge = machine.edges.find(
      (each) => each.from === state && each.event === event && !options.guarded.has(each.id),
    );
    const target = edge?.to ?? state;
    const outcome = edge === undefined ? "stay" : "transition";
    return {
      from: state,
      event,
      to: target,
      outcome,
      effects: [],
      sent: [],
      context: null,
      error: null,
    };
  }
  function run(steps: ReadonlyArray<VizStep>): VizLiveState {
    let state = machine.initial ?? "";
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      last = stepFrom(state, step);
      state = last.to;
    }
    return {
      state,
      steps: [...steps],
      last,
      after: [],
      timers: [],
      context: null,
      payload: null,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    };
  }
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return run([]);
    },
    step: (step) => {
      sent.push(step);
      return run(sent);
    },
    dryRun: (steps) => steps.map((step) => stepFrom(run(sent).state, step)),
    listen: (callback) => {
      listener = callback;
    },
  };
  /** The actor moved by itself, as an effect result does: the viewer hears `events` sent. */
  function arrive(events: ReadonlyArray<string>): void {
    for (const event of events) sent.push({ kind: "event", event, payload: null });
    listener?.(run(sent));
  }
  return { driver, sent, arrive };
}
