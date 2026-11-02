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

  function start(from: FuzzTarget) {
    const { actor, clock } = from.create();
    const internal = new Set(eventCatalog(actor).internal);
    const seen: { last: VizLiveStep | null } = { last: null };
    const steps: VizStep[] = [];
    actor.on("transition", {
      fn: ({ event, from: before, to, transitioned, effects }) => {
        seen.last = {
          from: before,
          event: event.type,
          to,
          outcome: transitioned ? "transition" : "stay",
          effects,
          context: json(contextText(actor)),
          error: null,
        };
      },
    });
    actor.on("error", {
      fn: (info) => {
        const error = messageOf(info.error);
        seen.last = {
          from: info.state.name,
          event: info.event.type,
          to: actor.state.name,
          outcome: "stay",
          effects: [],
          context: json(contextText(actor)),
          error,
        };
      },
    });
    return { actor, clock, internal, seen, steps };
  }

  function view(): VizLiveState {
    const { actor, clock, steps, seen } = session;
    return {
      state: actor.state.name,
      steps: [...steps],
      last: seen.last,
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
    reset() {
      session.actor.dispose();
      session = start(target);
      return view();
    },
    step(step) {
      const { actor, clock, internal, seen, steps } = session;
      seen.last = null;
      const before = actor.state.name;
      applyStep(actor, { step, clock, internal });
      steps.push(step);
      if (seen.last === null && step.kind === "event") {
        seen.last = {
          from: before,
          event: step.event,
          to: before,
          outcome: "ignored",
          effects: [],
          context: json(contextText(actor)),
          error: null,
        };
      }
      return view();
    },
  };
}
