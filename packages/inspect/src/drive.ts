import type {
  VizActorRef,
  VizDriver,
  VizJson,
  VizLiveState,
  VizLiveChild,
  VizLiveStep,
  VizMessage,
  VizRemovedChild,
  VizStep,
} from "@mantaq/viz";
import { drivesChild, runningEmbeds } from "./embeds/live-embeds.ts";
import { embedTagOf } from "./embeds/state-embeds.ts";
import { actorMapsOf } from "./maps.ts";
import type { ActorMapLike } from "./maps.ts";
import type { EmbedPart } from "./embeds/live-embeds.ts";
import {
  applyStep,
  isActor,
  contextText,
  eventCatalog,
  messageOf,
  otherActorsOf,
  parsed,
  regionActors,
  targetOf,
  withActors,
} from "./fuzz/run.ts";
import type { AnyActor, VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type { FuzzTarget } from "./fuzz/run.ts";

function json(text: string | null): VizJson {
  return parsed(text) as VizJson;
}

/** The current state's payload as JSON, or null when there is none or it is not serializable (functions, cycles). */
function payloadOf(actor: AnyActor<unknown>): VizJson {
  return jsonOf(actor.snapshot().payload) ?? null;
}

/** `value` as JSON; undefined when it is undefined or not serializable (functions, cycles). */
function jsonOf(payload: unknown): VizJson | undefined {
  if (payload === undefined) return undefined;
  const text = Either.from(() =>
    JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "function") throw new Error("function in payload");
      return value;
    }),
  );
  return Either.isRight(text) && text[1] !== undefined ? json(text[1]) : undefined;
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

/** Hold a child's effects; what they would report cannot reach it (only `forward` does), so they stay out of the root's `waiting`. */
function holdChild(child: unknown): void {
  if (isActor(child)) holdEffects(child, []);
}

/** An embed that forwards inputs or keeps its child snapshot still builds its child, so forwarded inputs reach it; the child's effects are held in turn. */
function heldEmbed(effect: unknown): (input: unknown) => unknown {
  function runHeld(input: unknown): unknown {
    if (typeof effect !== "function") return undefined;
    const given = typeof input === "object" && input !== null ? input : {};
    return Reflect.apply(effect, undefined, [{ ...given, childBuilt: holdChild }]);
  }
  return runHeld;
}

interface TaggedOptions {
  /** The effect fn that `effect` replaces. */
  from: unknown;
}

/** The `embedded` tag of an effect fn, carried to the fn that replaces it, so tools still find the child. */
function tagged<Effect extends object>(effect: Effect, options: TaggedOptions): Effect {
  const { from } = options;
  const tag: unknown = typeof from === "function" ? Reflect.get(from, "embedded") : undefined;
  return tag === undefined ? effect : Object.assign(effect, { embedded: tag });
}

/** Hold the children that the actor's current state already runs: core built them with the actor, before its effects could be swapped. */
function holdRunningChildren(actor: AnyActor<unknown>): void {
  for (const entry of actor.options?.effects?.[actor.state.name] ?? []) {
    const tag = embedTagOf(entry);
    if (tag !== undefined && drivesChild(entry)) holdChild(tag.running());
  }
}

/**
 * Swap each effect body for a stub that only records its signal; recurse into regions. An embed that drives
 * its child keeps running, with the child's effects held, also for a child the current state built already.
 */
function holdEffects(actor: AnyActor<unknown>, held: HeldEffect[]): void {
  for (const list of Object.values(actor.options?.effects ?? {})) {
    for (const [index, entry] of list.entries()) {
      if (!isEffectEntry(entry)) continue;
      if (drivesChild(entry)) {
        list[index] = { ...entry, fn: tagged(heldEmbed(entry.fn), { from: entry.fn }) };
        continue;
      }
      const { name } = entry;
      function stub(input: unknown): void {
        if (hasSignal(input)) held.push({ name, signal: input.signal });
      }
      list[index] = { ...entry, fn: tagged(stub, { from: entry.fn }) };
    }
  }
  holdRunningChildren(actor);
  for (const region of Object.values(actor.regions)) holdEffects(region, held);
}

export interface DriverOptions {
  /**
   * `held` (default): effect bodies do not run and the viewer asks what they report. First-state effects run while core builds the actor.
   * An embed that forwards or keeps builds its child, held the same way; the child's first-state effects run on each entry and dry run. `real`: all run.
   */
  effectMode?: "held" | "real";
}

type MapChildRef = Extract<VizActorRef, { map: string }>;

interface MapChild {
  map: string;
  key: string;
  child: AnyActor<unknown>;
  since: number;
}

/** Move a child from the live map to the removed list, keeping where it was. */
function dropChild(
  at: { children: Map<string, MapChild>; removed: VizRemovedChild[] },
  drop: { id: string; until: number },
): void {
  const { id, until } = drop;
  const entry = at.children.get(id);
  if (entry === undefined) return;
  const { map, key } = entry;
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
    if (at.maps[entry.map]?.get(entry.key) !== entry.child) dropChild(at, { id, until });
  }
}

interface LiveChildrenOptions {
  maps: Readonly<Record<string, ActorMapLike>>;
  children: Map<string, MapChild>;
  watch: (ref: MapChildRef) => void;
}

/** The children still in their maps: maps by name, then the map's key order. */
function liveChildren(options: LiveChildrenOptions): VizLiveChild[] {
  const { maps, children, watch } = options;
  return Object.entries(maps).flatMap(([name, map]) =>
    map.keys().flatMap((key) => {
      watch({ map: name, key });
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

/** A part of the running machine: its ref and state-id prefix, as its step entries carry them. */
interface Part {
  ref?: VizActorRef;
  prefix?: string;
}

/** What a part's state names start with in its step entries: nothing for the machine itself. */
function prefixOf(part: Part): string {
  return part.prefix === undefined ? "" : `${part.prefix}.`;
}

/** The part that last moved in this step or is sending now; "" is the machine, null no part. A wire on a part's `transition` listener registered in `create` runs before the driver's, so its sends stay null. */
interface Hearing {
  mover: string | null;
}

/** The name a message carries for a part: "" for the machine itself. */
function nameOf(ref: VizActorRef | undefined): string {
  if (ref === undefined) return "";
  return "region" in ref ? ref.region : ref.map;
}

/** A part that moved is the sender of what app code sends next. */
function noteMover(hearing: Hearing, entry: VizLiveStep): void {
  if (entry.outcome === "transition" || entry.outcome === "stay")
    hearing.mover = nameOf(entry.actor);
}

/**
 * Wrap a part's `send` so each message another part sends it is recorded: taken
 * when a handler ran, else dropped with an `ignored` entry. The step's own send is skipped.
 */
function wrapSend(
  actor: AnyActor<unknown>,
  part: Part,
  at: {
    root: AnyActor<unknown>;
    log: VizLiveStep[];
    flags: { own: { actor: AnyActor<unknown>; event: string } | null };
    hearing: Hearing;
    record: (e: VizLiveStep) => void;
  },
): void {
  const { root, log, flags, hearing, record } = at;
  const send = actor.send.bind(actor);
  actor.send = (event) => {
    const type = event.type;
    if (flags.own?.actor === actor && flags.own.event === type) {
      flags.own = null;
      send(event);
      return;
    }
    const known = new Set(log);
    const before = hearing.mover;
    const sender = before === nameOf(part.ref) ? null : before;
    hearing.mover = nameOf(part.ref);
    try {
      send(event);
    } finally {
      hearing.mover = before;
    }
    const taken = log.find(
      (entry) => !known.has(entry) && entry.event === type && entry.message === undefined,
    );
    const payload = "payload" in event ? jsonOf(event.payload) : undefined;
    const message: VizMessage = {
      sender,
      dropped: taken === undefined ? "noHandler" : null,
      ...(payload === undefined ? {} : { payload }),
    };
    if (taken !== undefined) {
      taken.message = message;
      return;
    }
    const state = `${prefixOf(part)}${actor.state.name}`;
    record({
      from: state,
      event: type,
      to: state,
      outcome: "ignored",
      ...(part.ref === undefined ? {} : { actor: part.ref }),
      effects: [],
      context: json(contextText(root)),
      error: null,
      sent: [],
      message,
    });
  };
}

interface WatchMapsOptions {
  watch: (ref: MapChildRef) => void;
  changed: () => void;
}

/** Wrap spawn and ensure so every new child is watched, kill so a removed child redraws, and watch the ones already there. */
function watchMaps(maps: Readonly<Record<string, ActorMapLike>>, options: WatchMapsOptions): void {
  const { watch, changed } = options;
  for (const [name, map] of Object.entries(maps)) {
    const spawn = map.spawn.bind(map);
    const ensure = map.ensure.bind(map);
    const kill = map.kill.bind(map);
    map.kill = (key) => {
      kill(key);
      changed();
    };
    map.spawn = (key) => {
      spawn(key);
      watch({ map: name, key });
    };
    map.ensure = (key) => {
      ensure(key);
      watch({ map: name, key });
    };
    for (const key of map.keys()) watch({ map: name, key });
  }
}

interface WatchPartOptions {
  /** The machine whose context every entry carries. */
  root: AnyActor<unknown>;
  part: Part;
  record: (entry: VizLiveStep) => void;
}

/** Record every transition and error of one part: the machine itself, a region, another machine or a map child. */
function watchPart(actor: AnyActor<unknown>, options: WatchPartOptions): void {
  const { root, part, record } = options;
  const tag = part.ref === undefined ? {} : { actor: part.ref };
  const prefix = prefixOf(part);
  actor.on("transition", {
    fn: ({ event, from: before, to, transitioned, effects }) => {
      record({
        from: `${prefix}${before}`,
        event: event.type,
        to: `${prefix}${to}`,
        outcome: transitioned ? "transition" : "stay",
        ...tag,
        effects,
        context: json(contextText(root)),
        error: null,
        sent: [],
      });
    },
  });
  actor.on("error", {
    fn: (info) => {
      record({
        from: `${prefix}${info.state.name}`,
        event: info.event.type,
        to: `${prefix}${actor.state.name}`,
        outcome: "stay",
        ...tag,
        effects: [],
        context: json(contextText(root)),
        error: messageOf(info.error),
        sent: [],
      });
    },
  });
}

/** Record the other machines the factory returned, tagged like regions, and hold their effects when `held` is a list. */
function watchActors(
  actors: Readonly<Record<string, AnyActor<unknown>>>,
  at: {
    root: AnyActor<unknown>;
    record: (e: VizLiveStep) => void;
    held: HeldEffect[] | null;
    joined: (actor: AnyActor<unknown>, part: Part) => void;
  },
): void {
  for (const [name, part] of Object.entries(actors)) {
    if (at.held !== null) holdEffects(part, at.held);
    const joining: Part = { ref: { region: name }, prefix: name };
    watchPart(part, { root: at.root, part: joining, record: at.record });
    at.joined(part, joining);
  }
}

/** The log entry for an event nobody handled: ignored, or missing when its actor does not exist. */
function unhandled(
  step: Extract<VizStep, { kind: "event" }>,
  at: { actor: AnyActor<unknown>; target: AnyActor<unknown> | undefined; root: string },
): VizLiveStep {
  const ref = step.actor;
  const gone = ref !== undefined && at.target === undefined;
  const scope = nameOf(ref);
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

function newFlags(quiet: boolean): Stepping["flags"] & { disposed: boolean } {
  return { inside: true, disposed: quiet, segment: 0, pending: 0, own: null };
}

interface Stepping {
  actor: AnyActor<unknown>;
  clock: VirtualClock;
  internal: Set<string>;
  log: VizLiveStep[];
  steps: VizStep[];
  flags: {
    inside: boolean;
    segment: number;
    pending: number;
    own: { actor: AnyActor<unknown>; event: string } | null;
  };
  /** The part that last moved, for naming a message's sender. */
  hearing: Hearing;
  maps: Record<string, ActorMapLike>;
  actors: Record<string, AnyActor<unknown>>;
}

/** Apply one step to a session and return the log entry it produced. */
function stepOn(at: Stepping, step: VizStep): VizLiveStep | undefined {
  const { actor, clock, internal, log, steps, flags, maps, actors, hearing } = at;
  log.length = 0;
  hearing.mover = null;
  flags.segment = 0;
  flags.inside = true;
  flags.pending = 1;
  const before = actor.state.name;
  const target = step.kind === "event" ? targetOf(actor, step.actor, maps, actors) : undefined;
  if (target !== undefined && step.kind === "event") {
    flags.own = { actor: target, event: step.event };
  }
  try {
    applyStep(actor, { step, clock, internal, maps, actors });
  } finally {
    flags.inside = false;
    flags.pending = 0;
    hearing.mover = null;
  }
  steps.push(step);
  if (step.kind !== "event") return undefined;
  const own = log.findIndex(
    (entry) =>
      entry.message === undefined &&
      entry.event === step.event &&
      sameActor(entry.actor, step.actor),
  );
  const [entry] = own === -1 ? [] : log.splice(own, 1);
  if (entry !== undefined) log.unshift(entry);
  else log.unshift(unhandled(step, { actor, target, root: before }));
  return log[0];
}

/** The state name of every region, as one comparable string. */
function regionsOf(at: Stepping): string {
  return JSON.stringify([
    ...regionActors(at.actor).map((each) => [each.path, each.actor.state.name]),
    ...Object.entries(at.actors).map(([name, part]) => [name, part.state.name]),
  ]);
}

function retire(copy: Session): void {
  disposeParts(copy);
  copy.actor.dispose();
}

/** Each state a quiet copy is in at the start and after `steps`; stops after a step that throws. Disposes the copy. */
function walkCopy(copy: Session, steps: ReadonlyArray<VizStep>): VizLiveState[] {
  const out = [liveView(copy, "held")];
  Either.from(() => {
    for (const step of steps) {
      stepOn(copy, step);
      out.push(liveView(copy, "held"));
    }
  });
  retire(copy);
  return out;
}

/** What a running session looks like now: sweeps gone children and spent held effects first. */
function liveView(session: Session, effectMode: "held" | "real"): VizLiveState {
  const { actor, clock, steps, log, held, maps, actors, children, removed, watch } = session;
  sweepRemoved({ maps, children, removed }, steps.length);
  const waiting = held.filter((each) => !each.signal.aborted);
  held.splice(0, held.length, ...waiting);
  return {
    state: actor.state.name,
    regions: Object.fromEntries(
      withActors(regionActors(actor), actors).map((each) => [
        each.path,
        `${each.path}.${each.actor.state.name}`,
      ]),
    ),
    children: liveChildren({ maps, children, watch }),
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
    embeds: runningEmbeds(embedParts(actor, actors)),
  };
}

/** Dispose the maps and the other machines a session started; the root actor is the caller's. */
function disposeParts(at: Stepping): void {
  for (const map of Object.values(at.maps)) map.dispose();
  for (const part of Object.values(at.actors)) part.dispose();
}

interface Session extends Stepping {
  held: HeldEffect[];
  children: Map<string, MapChild>;
  removed: VizRemovedChild[];
  watch: (ref: MapChildRef) => void;
}

/** The parts whose states can embed machines: the machine, its regions and its returned machines. */
function embedParts(
  actor: AnyActor<unknown>,
  actors: Readonly<Record<string, AnyActor<unknown>>>,
): EmbedPart[] {
  const parts: EmbedPart[] = [{ actor, prefix: "" }];
  for (const part of withActors(regionActors(actor), actors)) {
    parts.push({ actor: part.actor, prefix: `${part.path}.` });
  }
  return parts;
}

/**
 * A running actor for the viewer. Steps go through the same function the
 * fuzzer replays with, so live and fuzzed behaviour cannot drift. No node APIs.
 */
export function createDriver(target: FuzzTarget, options: DriverOptions = {}): VizDriver {
  const effectMode = options.effectMode ?? "held";
  let session = start(target);
  let onChange: ((state: VizLiveState) => void) | null = null;

  function start(from: FuzzTarget, quiet = false) {
    const { actor, clock, made } = from.create();
    const maps: Record<string, ActorMapLike> = actorMapsOf(made).maps;
    const actors = otherActorsOf(made, actor);
    const internal = new Set(eventCatalog(actor).internal);
    const log: VizLiveStep[] = [];
    const steps: VizStep[] = [];
    const flags = newFlags(quiet);
    const hearing: Hearing = { mover: null };
    const held: HeldEffect[] = [];
    const holding = quiet || effectMode === "held";
    if (holding) holdEffects(actor, held);

    markTimerStarts(clock, () => {
      flags.segment = log.length;
    });

    function record(entry: VizLiveStep): void {
      noteMover(hearing, entry);
      if (startedFollowUp(entry, { log, flags })) log.splice(flags.segment, 0, entry);
      else log.push(entry);
      changed();
    }

    function changed(): void {
      if (!flags.inside && !flags.disposed) onChange?.(view());
    }

    const joined = (receiver: AnyActor<unknown>, part: Part): void => {
      wrapSend(receiver, part, { root: actor, log, flags, hearing, record });
    };

    watchPart(actor, { root: actor, part: {}, record });
    watchOutputs(actor, { log, changed });
    joined(actor, {});
    for (const { path, actor: region } of regionActors(actor)) {
      watchPart(region, { root: actor, part: { ref: { region: path }, prefix: path }, record });
    }
    watchActors(actors, { root: actor, record, held: holding ? held : null, joined });

    const children = new Map<string, MapChild>();
    const removed: VizRemovedChild[] = [];
    function watch(ref: MapChildRef): void {
      const child = maps[ref.map]?.get(ref.key);
      const id = `${ref.map}\u0000${ref.key}`;
      if (!isActor(child)) return;
      const old = children.get(id);
      if (old?.child === child) return;
      const since = steps.length + flags.pending;
      if (old !== undefined) dropChild({ children, removed }, { id, until: since });
      children.set(id, { ...ref, child, since });
      if (holding) holdEffects(child, held);
      const part: Part = { ref, prefix: ref.map };
      watchPart(child, { root: actor, part, record });
      joined(child, part);
    }
    watchMaps(maps, { watch, changed });
    flags.inside = false;
    return {
      actor,
      clock,
      internal,
      log,
      steps,
      flags,
      hearing,
      held,
      maps,
      actors,
      children,
      removed,
      watch,
    };
  }

  function view(): VizLiveState {
    return liveView(session, effectMode);
  }

  /** Replay the walk on a fresh quiet copy, then apply the candidate. Null when the copy drifted or threw. */
  function tryOnCopy(candidate: VizStep): VizLiveStep | null {
    const live = session;
    const copy = start(target, true);
    const result = Either.from(() => {
      for (const done of live.steps) stepOn(copy, done);
      const same =
        copy.actor.state.name === live.actor.state.name &&
        regionsOf(copy) === regionsOf(live) &&
        contextText(copy.actor) === contextText(live.actor);
      return same ? (stepOn(copy, candidate) ?? null) : null;
    });
    retire(copy);
    return Either.isRight(result) ? result[1] : null;
  }

  return {
    listen(callback) {
      onChange = callback;
    },
    reset() {
      session.flags.disposed = true;
      retire(session);
      session = start(target);
      return view();
    },
    step(step) {
      stepOn(session, step);
      return view();
    },
    dryRun(candidates) {
      return candidates.map((candidate) => tryOnCopy(candidate));
    },
    dryWalk: (steps) => walkCopy(start(target, true), steps),
  };
}
