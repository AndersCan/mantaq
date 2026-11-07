import type { VizDriver, VizJson, VizLiveState, VizLiveStep, VizStep } from "@mantaq/viz";
import { applyStep, contextText, eventCatalog, messageOf, parsed } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";

function json(text: string | null): VizJson {
  return parsed(text) as VizJson;
}

/**
 * A running actor for the viewer. Steps go through the same function the
 * fuzzer replays with, so live and fuzzed behaviour cannot drift. No node APIs.
 */
export function createDriver(target: FuzzTarget): VizDriver {
  let session = start(target);
  let onChange: ((state: VizLiveState) => void) | null = null;

  function start(from: FuzzTarget) {
    const { actor, clock } = from.create();
    const internal = new Set(eventCatalog(actor).internal);
    const log: VizLiveStep[] = [];
    const steps: VizStep[] = [];
    const flags = { inside: true, disposed: false };

    /** Core reports a transition after its effects ran, so a follow-up a sync effect sent is recorded before the transition that started it: put the starter first. */
    function startedFollowUp(entry: VizLiveStep): boolean {
      return flags.inside && entry.effects.length > 0 && entry.to === log[0]?.from;
    }

    function record(entry: VizLiveStep): void {
      if (startedFollowUp(entry)) log.unshift(entry);
      else log.push(entry);
      if (!flags.inside && !flags.disposed) onChange?.(view());
    }

    actor.on("transition", {
      fn: ({ event, from: before, to, transitioned, effects }) => {
        record({
          from: before,
          event: event.type,
          to,
          outcome: transitioned ? "transition" : "stay",
          effects,
          context: json(contextText(actor)),
          error: null,
        });
      },
    });
    actor.on("error", {
      fn: (info) => {
        record({
          from: info.state.name,
          event: info.event.type,
          to: actor.state.name,
          outcome: "stay",
          effects: [],
          context: json(contextText(actor)),
          error: messageOf(info.error),
        });
      },
    });
    flags.inside = false;
    return { actor, clock, internal, log, steps, flags };
  }

  function view(): VizLiveState {
    const { actor, clock, steps, log } = session;
    return {
      state: actor.state.name,
      steps: [...steps],
      last: log[0] ?? null,
      after: log.slice(1),
      timers: clock.pendingTimers().map((timer) => ({
        id: String(timer.id),
        ms: timer.ms,
        deadline: timer.deadline,
        eventName: timer.eventName ?? null,
      })),
      context: json(contextText(actor)),
    };
  }

  return {
    listen(callback) {
      onChange = callback;
    },
    reset() {
      session.flags.disposed = true;
      session.actor.dispose();
      session = start(target);
      return view();
    },
    step(step) {
      const { actor, clock, internal, log, steps, flags } = session;
      log.length = 0;
      flags.inside = true;
      const before = actor.state.name;
      try {
        applyStep(actor, { step, clock, internal });
      } finally {
        flags.inside = false;
      }
      steps.push(step);
      if (log.length === 0 && step.kind === "event") {
        log.push({
          from: before,
          event: step.event,
          to: before,
          outcome: "ignored",
          effects: [],
          context: json(contextText(actor)),
          error: null,
        });
      }
      return view();
    },
  };
}
