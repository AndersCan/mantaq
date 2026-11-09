import type {
  VizActorRef,
  VizDriver,
  VizJson,
  VizLiveState,
  VizLiveChild,
  VizLiveStep,
  VizRemovedChild,
  VizStep,
} from "@mantaq/viz";
import { actorMapsOf } from "./maps.ts";
import type { ActorMapLike } from "./maps.ts";
import {
  applyStep,
  isActor,
  contextText,
  eventCatalog,
  messageOf,
  parsed,
  regionActors,
  targetOf,
} from "./fuzz/run.ts";
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

/** Record every transition and error of the regions, tagged with the region and prefixed ids. */
function watchRegions(root: AnyActor<unknown>, record: (entry: VizLiveStep) => void): void {
  for (const { path, actor: region } of regionActors(root)) {
    const ref: VizActorRef = { region: path };
    region.on("transition", {
      fn: ({ event, from: before, to, transitioned, effects }) => {
        record({
          from: `${path}.${before}`,
          event: event.type,
          to: `${path}.${to}`,
          outcome: transitioned ? "transition" : "stay",
          actor: ref,
          effects,
          context: json(contextText(root)),
          error: null,
          sent: [],
        });
      },
    });
    region.on("error", {
      fn: (info) => {
        record({
          from: `${path}.${info.state.name}`,
          event: info.event.type,
          to: `${path}.${region.state.name}`,
          outcome: "stay",
          actor: ref,
          effects: [],
          context: json(contextText(root)),
          error: messageOf(info.error),
          sent: [],
        });
      },
    });
  }
}

interface MapChild {
  child: AnyActor<unknown>;
  since: number;
}

/** Move a child from the live map to the removed list, keeping where it was. */
function dropChild(
  at: { children: Map<string, MapChild>; removed: VizRemovedChild[] },
  id: string,
  until: number,
): void {
  const entry = at.children.get(id);
  if (entry === undefined) return;
  const [map = "", key = ""] = id.split("\u0000");
  at.removed.push({
    map,
    key,
    state: `${map}.${entry.child.state.name}`,
    since: entry.since,
    until,
  });
  at.children.delete(id);
}

/** Drop every child its map no longer holds (killed, replaced or reaped). */
function sweepRemoved(
  at: {
    maps: Readonly<Record<string, ActorMapLike>>;
    children: Map<string, MapChild>;
    removed: VizRemovedChild[];
  },
  until: number,
): void {
  for (const [id, entry] of at.children) {
    const [map = "", key = ""] = id.split("\u0000");
    if (at.maps[map]?.get(key) !== entry.child) dropChild(at, id, until);
  }
}

/** The children still in their maps: maps by name, then the map's key order. */
function liveChildren(
  maps: Readonly<Record<string, ActorMapLike>>,
  children: Map<string, MapChild>,
  watch: (name: string, key: string) => void,
): VizLiveChild[] {
  return Object.entries(maps).flatMap(([name, map]) =>
    map.keys().flatMap((key) => {
      watch(name, key);
      const entry = children.get(`${name}\u0000${key}`);
      return entry === undefined
        ? []
        : [{ map: name, key, state: `${name}.${entry.child.state.name}`, since: entry.since }];
    }),
  );
}

/** Core reports a transition after its effects ran, so a follow-up a sync effect sent is recorded before the transition that started it: put the starter first. */
function startedFollowUp(
  entry: VizLiveStep,
  recorded: { log: VizLiveStep[]; flags: { inside: boolean; segment: number } },
): boolean {
  const { log, flags } = recorded;
  return flags.inside && entry.effects.length > 0 && entry.to === log[flags.segment]?.from;
}

/** Core emits an output right after the transition that caused it: file it on the latest entry. */
function watchOutputs(
  actor: AnyActor<unknown>,
  context: { log: VizLiveStep[]; changed: () => void },
): void {
  actor.on("output", {
    fn: (event) => {
      context.log.at(-1)?.sent.push(event.type);
      context.changed();
    },
  });
}

/** Record the root actor's own transitions and errors. */
function watchRoot(actor: AnyActor<unknown>, record: (entry: VizLiveStep) => void): void {
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
        sent: [],
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
        sent: [],
      });
    },
  });
}

/** Wrap spawn and ensure so every new child is watched, and watch the ones already there. */
function watchMaps(
  maps: Readonly<Record<string, ActorMapLike>>,
  watch: (name: string, key: string) => void,
): void {
  for (const [name, map] of Object.entries(maps)) {
    const spawn = map.spawn.bind(map);
    const ensure = map.ensure.bind(map);
    map.spawn = (key) => {
      spawn(key);
      watch(name, key);
    };
    map.ensure = (key) => {
      ensure(key);
      watch(name, key);
    };
    for (const key of map.keys()) watch(name, key);
  }
}

/** Record every transition and error of one actor, tagged with its ref and prefixed ids. */
function watchChild(
  child: AnyActor<unknown>,
  at: {
    root: AnyActor<unknown>;
    ref: VizActorRef;
    prefix: string;
    record: (e: VizLiveStep) => void;
  },
): void {
  const { root, ref, prefix, record } = at;
  child.on("transition", {
    fn: ({ event, from: before, to, transitioned, effects }) => {
      record({
        from: `${prefix}.${before}`,
        event: event.type,
        to: `${prefix}.${to}`,
        outcome: transitioned ? "transition" : "stay",
        actor: ref,
        effects,
        context: json(contextText(root)),
        error: null,
        sent: [],
      });
    },
  });
  child.on("error", {
    fn: (info) => {
      record({
        from: `${prefix}.${info.state.name}`,
        event: info.event.type,
        to: `${prefix}.${child.state.name}`,
        outcome: "stay",
        actor: ref,
        effects: [],
        context: json(contextText(root)),
        error: messageOf(info.error),
        sent: [],
      });
    },
  });
}

/** The log entry for an event nobody handled: ignored, or missing when its actor does not exist. */
function unhandled(
  step: Extract<VizStep, { kind: "event" }>,
  at: { actor: AnyActor<unknown>; target: AnyActor<unknown> | undefined; root: string },
): VizLiveStep {
  const ref = step.actor;
  const gone = ref !== undefined && at.target === undefined;
  const scope = ref === undefined ? "" : "region" in ref ? ref.region : ref.map;
  const here = ref === undefined ? at.root : `${scope}.${at.target?.state.name ?? ""}`;
  const state = gone ? "" : here;
  return {
    from: state,
    event: step.event,
    to: state,
    outcome: gone ? "missing" : "ignored",
    ...(ref === undefined ? {} : { actor: ref }),
    effects: [],
    context: json(contextText(at.actor)),
    error: null,
    sent: [],
  };
}

function sameActor(left: VizActorRef | undefined, right: VizActorRef | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if ("region" in left || "region" in right) {
    return "region" in left && "region" in right && left.region === right.region;
  }
  return left.map === right.map && left.key === right.key;
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
    const { actor, clock, made } = from.create();
    const maps: Record<string, ActorMapLike> = actorMapsOf(made).maps;
    const internal = new Set(eventCatalog(actor).internal);
    const log: VizLiveStep[] = [];
    const steps: VizStep[] = [];
    const flags = { inside: true, disposed: false, segment: 0, pending: 0 };
    const held: HeldEffect[] = [];
    if (effectMode === "held") holdEffects(actor, held);

    markTimerStarts(clock, () => {
      flags.segment = log.length;
    });

    function record(entry: VizLiveStep): void {
      if (startedFollowUp(entry, { log, flags })) log.splice(flags.segment, 0, entry);
      else log.push(entry);
      changed();
    }

    function changed(): void {
      if (!flags.inside && !flags.disposed) onChange?.(view());
    }

    watchRoot(actor, record);
    watchOutputs(actor, { log, changed });
    watchRegions(actor, record);

    const children = new Map<string, MapChild>();
    const removed: VizRemovedChild[] = [];
    const watch = (name: string, key: string): void => {
      const child = maps[name]?.get(key);
      const id = `${name}\u0000${key}`;
      if (!isActor(child)) return;
      const old = children.get(id);
      if (old?.child === child) return;
      if (old !== undefined) dropChild({ children, removed }, id, steps.length + flags.pending);
      children.set(id, { child, since: steps.length + flags.pending });
      if (effectMode === "held") holdEffects(child, held);
      watchChild(child, { root: actor, ref: { map: name, key }, prefix: name, record });
    };
    watchMaps(maps, watch);
    flags.inside = false;
    return { actor, clock, internal, log, steps, flags, held, maps, children, removed, watch };
  }

  function view(): VizLiveState {
    const { actor, clock, steps, log, held, maps, children, removed, watch } = session;
    sweepRemoved({ maps, children, removed }, steps.length);
    const waiting = held.filter((each) => !each.signal.aborted);
    held.splice(0, held.length, ...waiting);
    return {
      state: actor.state.name,
      regions: Object.fromEntries(
        regionActors(actor).map((each) => [each.path, `${each.path}.${each.actor.state.name}`]),
      ),
      children: liveChildren(maps, children, watch),
      removed: [...removed],
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
      for (const map of Object.values(session.maps)) map.dispose();
      session.actor.dispose();
      session = start(target);
      return view();
    },
    step(step) {
      const { actor, clock, internal, log, steps, flags, maps } = session;
      log.length = 0;
      flags.segment = 0;
      flags.inside = true;
      flags.pending = 1;
      const before = actor.state.name;
      const target = step.kind === "event" ? targetOf(actor, step.actor, maps) : undefined;
      try {
        applyStep(actor, { step, clock, internal, maps });
      } finally {
        flags.inside = false;
        flags.pending = 0;
      }
      steps.push(step);
      if (step.kind === "event") {
        const own = log.findIndex(
          (entry) => entry.event === step.event && sameActor(entry.actor, step.actor),
        );
        const [entry] = own === -1 ? [] : log.splice(own, 1);
        if (entry !== undefined) log.unshift(entry);
        else log.unshift(unhandled(step, { actor, target, root: before }));
      }
      return view();
    },
  };
}
