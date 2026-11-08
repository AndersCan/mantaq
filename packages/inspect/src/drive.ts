import type { VizDriver, VizJson, VizLiveState, VizLiveStep, VizStep } from "@mantaq/viz";
import { applyStep, contextText, eventCatalog, messageOf, parsed } from "./fuzz/run.ts";
import type { AnyActor, VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type { FuzzTarget } from "./fuzz/run.ts";

function json(text: string | null): VizJson {
  return parsed(text) as VizJson;
}

/** The current state's payload as JSON, or null when there is none or it is not serializable (functions, cycles). */
function payloadOf(actor: AnyActor<unknown>): VizJson {
  const payload = actor.snapshot().payload;
  if (payload === undefined) return null;
  const text = Either.from(() =>
    JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "function") throw new Error("function in payload");
      return value;
    }),
  );
  return Either.isRight(text) && text[1] !== undefined ? json(text[1]) : null;
}

/** Each timer callback starts a new top-level dispatch; report it so follow-ups are only matched within one dispatch. */
function markTimerStarts(clock: VirtualClock, onStart: () => void): void {
  const setTimer = clock.setTimeout.bind(clock);
  const setRepeat = clock.setInterval.bind(clock);
  const wrap = (cb: () => void) => () => {
    onStart();
    cb();
  };
  clock.setTimeout = (ms, options) => setTimer(ms, { ...options, cb: wrap(options.cb) });
  clock.setInterval = (ms, options) => setRepeat(ms, { ...options, cb: wrap(options.cb) });
}

interface HeldEffect {
  name: string;
  signal: AbortSignal;
}

function isEffectEntry(value: unknown): value is { name: string; fn: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "fn" in value &&
    typeof value.fn === "function"
  );
}

function hasSignal(value: unknown): value is { signal: AbortSignal } {
  return (
    typeof value === "object" &&
    value !== null &&
    "signal" in value &&
    value.signal instanceof AbortSignal
  );
}

/** Swap each effect body for a stub that only records its signal; recurse into regions. */
function holdEffects(actor: AnyActor<unknown>, held: HeldEffect[]): void {
  for (const list of Object.values(actor.options?.effects ?? {})) {
    for (const [index, entry] of list.entries()) {
      if (!isEffectEntry(entry)) continue;
      list[index] = {
        ...entry,
        fn: (input: unknown) => {
          if (hasSignal(input)) held.push({ name: entry.name, signal: input.signal });
        },
      };
    }
  }
  for (const region of Object.values(actor.regions)) holdEffects(region, held);
}

export interface DriverOptions {
  /** `held` (default): effect bodies do not run and the viewer asks what they report; first-state effects still run, because core runs them while the actor is built. `real`: they run. */
  effectMode?: "held" | "real";
}

/**
 * A running actor for the viewer. Steps go through the same function the
 * fuzzer replays with, so live and fuzzed behaviour cannot drift. No node APIs.
 */
export function createDriver(target: FuzzTarget, options: DriverOptions = {}): VizDriver {
  const effectMode = options.effectMode ?? "held";
  let session = start(target);
  let onChange: ((state: VizLiveState) => void) | null = null;

  function start(from: FuzzTarget) {
    const { actor, clock } = from.create();
    const internal = new Set(eventCatalog(actor).internal);
    const log: VizLiveStep[] = [];
    const steps: VizStep[] = [];
    const flags = { inside: true, disposed: false, segment: 0 };
    const held: HeldEffect[] = [];
    if (effectMode === "held") holdEffects(actor, held);

    markTimerStarts(clock, () => {
      flags.segment = log.length;
    });

    /** Core reports a transition after its effects ran, so a follow-up a sync effect sent is recorded before the transition that started it: put the starter first. */
    function startedFollowUp(entry: VizLiveStep): boolean {
      return flags.inside && entry.effects.length > 0 && entry.to === log[flags.segment]?.from;
    }

    function record(entry: VizLiveStep): void {
      if (startedFollowUp(entry)) log.splice(flags.segment, 0, entry);
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
    return { actor, clock, internal, log, steps, flags, held };
  }

  function view(): VizLiveState {
    const { actor, clock, steps, log, held } = session;
    const waiting = held.filter((each) => !each.signal.aborted);
    held.splice(0, held.length, ...waiting);
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
      payload: payloadOf(actor),
      effectMode,
      waiting: waiting.map((each) => each.name),
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
      flags.segment = 0;
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
