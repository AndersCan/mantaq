import type { AnyStateRef, StateRef, TransitionState } from "./state.ts";
import { TransitionState as TransitionStateClass } from "./state.ts";
import type { AnyEventRef, EventRef } from "./event.ts";

export interface Snapshot {
  path: string[];
  regions: Record<string, Snapshot>;
  done?: boolean;
}

export interface Clock {
  setTimeout(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number;
  clearTimeout(id: number): void;
  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number;
  clearInterval(id: number): void;
  now(): number;
}

export class RealClock implements Clock {
  #start = Date.now();

  now(): number {
    return Date.now() - this.#start;
  }

  setTimeout(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const id = globalThis.setTimeout(cb, ms) as unknown as number;
    if (options?.signal) {
      options.signal.addEventListener("abort", () => globalThis.clearTimeout(id), { once: true });
    }
    return id;
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
  }

  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const id = globalThis.setInterval(cb, ms) as unknown as number;
    if (options?.signal) {
      options.signal.addEventListener("abort", () => globalThis.clearInterval(id), { once: true });
    }
    return id;
  }

  clearInterval(id: number): void {
    globalThis.clearInterval(id);
  }
}

export class VirtualClock implements Clock {
  #now = 0;
  #timers: Map<
    number,
    { deadline: number; cb: () => void; signal?: AbortSignal; onAbort?: () => void }
  > = new Map();
  #intervals: Map<
    number,
    { ms: number; next: number; cb: () => void; signal?: AbortSignal; onAbort?: () => void }
  > = new Map();
  #nextId = 1;
  #drain: (() => void) | null = null;

  now(): number {
    return this.#now;
  }

  #trackAbort(
    signal: AbortSignal | undefined,
    id: number,
    map: Map<number, { signal?: AbortSignal; onAbort?: () => void }>,
  ): (() => void) | undefined {
    const onAbort = signal
      ? () => {
          map.delete(id);
        }
      : undefined;
    if (signal && onAbort) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return onAbort;
  }

  #clearAbort(timer: { signal?: AbortSignal; onAbort?: () => void }): void {
    if (timer.signal && timer.onAbort) {
      timer.signal.removeEventListener("abort", timer.onAbort);
    }
  }

  setTimeout(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const signal = options?.signal;
    if (signal?.aborted) return -1;
    const id = this.#nextId++;
    const onAbort = this.#trackAbort(signal, id, this.#timers);
    this.#timers.set(id, { deadline: this.#now + ms, cb, signal, onAbort });
    return id;
  }

  clearTimeout(id: number): void {
    const timer = this.#timers.get(id);
    if (timer) {
      this.#clearAbort(timer);
      this.#timers.delete(id);
    }
  }

  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number {
    const signal = options?.signal;
    if (signal?.aborted) return -1;
    const id = this.#nextId++;
    const onAbort = this.#trackAbort(signal, id, this.#intervals);
    this.#intervals.set(id, { ms, next: this.#now + ms, cb, signal, onAbort });
    return id;
  }

  clearInterval(id: number): void {
    const interval = this.#intervals.get(id);
    if (interval) {
      this.#clearAbort(interval);
      this.#intervals.delete(id);
    }
  }

  advance(ms: number): void {
    const target = this.#now + ms;

    while (true) {
      let earliest = target;
      let hasEvent = false;

      for (const t of this.#timers.values()) {
        if (t.deadline <= target && t.deadline <= earliest) {
          earliest = t.deadline;
          hasEvent = true;
        }
      }
      for (const t of this.#intervals.values()) {
        if (t.next <= target && t.next <= earliest) {
          earliest = t.next;
          hasEvent = true;
        }
      }

      if (!hasEvent) break;

      this.#now = earliest;

      const timerIds: number[] = [];
      for (const [id, t] of this.#timers) {
        if (t.deadline === earliest) timerIds.push(id);
      }
      for (const id of timerIds) {
        const timer = this.#timers.get(id);
        if (timer) {
          if (timer.signal && timer.onAbort) {
            timer.signal.removeEventListener("abort", timer.onAbort);
          }
          this.#timers.delete(id);
          timer.cb();
        }
      }

      const intervalIds: number[] = [];
      for (const [id, t] of this.#intervals) {
        if (t.next === earliest) intervalIds.push(id);
      }
      for (const id of intervalIds) {
        const interval = this.#intervals.get(id);
        if (interval) {
          interval.cb();
          if (this.#intervals.has(id)) {
            interval.next = this.#now + interval.ms;
          }
        }
      }
    }

    this.#now = target;
    this.#drain?.();
  }

  hasPending(): boolean {
    return this.#timers.size > 0 || this.#intervals.size > 0;
  }

  /** @internal */
  _setDrain(fn: () => void): void {
    this.#drain = fn;
  }
}

export type EffectFn<Inputs extends AnyEventRef[], Internal extends AnyEventRef[], ActorContext> = (
  options: EffectInput<Inputs, Internal, ActorContext>,
) => void;

export type EffectInput<
  Inputs extends AnyEventRef[],
  Internal extends AnyEventRef[],
  ActorContext,
> = {
  signal: AbortSignal;
  state: { name: string; payload: unknown };
  event: Inputs[number] | Internal[number];
  context: ActorContext;
  emit: (event: { id: string; [key: string]: unknown }) => void;
  clock: Clock;
};

export interface AnyActor {
  state: AnyStateRef;
  clock: Clock;
  regions: Record<string, AnyActor>;
  send(event: AnyEventRef | { id: string; [key: string]: unknown }): void;
  snapshot(): Snapshot;
  on(event: "change", fn: (snapshot: Snapshot) => void): () => void;
  on(event: "error", fn: (error: unknown) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  settled(): Promise<void>;
  __children: Map<string, AnyActor>;
  __outputHandler: ((event: { id: string; [key: string]: unknown }) => void) | null;
  __pushInternal(event: { id: string; [key: string]: unknown }): void;
  __drainInternal(): void;
  __abortEffects(): void;
}

export class Actor<
  const Inputs extends AnyEventRef[],
  const Outputs extends AnyEventRef[],
  const Internal extends AnyEventRef[],
  const States extends AnyStateRef[],
  const InternalNames extends Internal[number]["id"],
  const StateNames extends States[number]["name"],
  const ActorContext,
> {
  state: States[number];
  #context: ActorContext;
  clock: Clock;
  #regions: Record<string, AnyActor> = {};
  #children: Map<string, AnyActor> = new Map();
  #internalQueue: Array<{ id: string; [key: string]: unknown }> = [];
  #queueIndex = 0;
  #effectAbort: AbortController | null = null;
  #outputHandler: ((event: { id: string; [key: string]: unknown }) => void) | null = null;
  #processing = false;
  #internalIds: Set<string> = new Set();
  #subscribers: Set<(snapshot: Snapshot) => void> = new Set();
  #errorSubscribers: Set<(error: unknown) => void> = new Set();
  #doneSubscribers: Set<() => void> = new Set();
  #settledResolvers: Array<() => void> = [];

  get context(): Readonly<ActorContext> {
    return this.#context;
  }

  get regions(): Record<string, AnyActor> {
    return this.#regions;
  }

  /** @internal */ get __children(): Map<string, AnyActor> {
    return this.#children;
  }
  /** @internal */ get __outputHandler():
    | ((event: { id: string; [key: string]: unknown }) => void)
    | null {
    return this.#outputHandler;
  }
  /** @internal */ set __outputHandler(
    fn: ((event: { id: string; [key: string]: unknown }) => void) | null,
  ) {
    this.#outputHandler = fn;
  }
  /** @internal */ __pushInternal(event: { id: string; [key: string]: unknown }): void {
    this.#internalQueue.push(event);
  }
  /** @internal */ __drainInternal(): void {
    this.#processInternalQueue();
  }
  /** @internal */ __abortEffects(): void {
    this.#effectAbort?.abort();
    this.#subscribers.clear();
    this.#errorSubscribers.clear();
    this.#doneSubscribers.clear();
  }

  options: {
    inputs: Inputs;
    outputs: Outputs;
    internal: Internal;
    states: States;
    context: ActorContext;
    initial: InitialState<States[number]>;
    effects: Partial<
      Record<StateNames, Array<EffectFn<Inputs | Internal, Internal, ActorContext>>>
    >;
    transitions: Partial<
      Record<
        StateNames | "Any",
        Partial<{
          [Id in Inputs[number]["id"] | InternalNames]: (
            event: ById<Inputs[number] | Internal[number], Id>,
            options: { context: ActorContext; actor: AnyActor },
          ) => TransitionResult;
        }>
      >
    >;
  };

  constructor(options: {
    inputs: Inputs;
    outputs?: Outputs;
    internal?: Internal;
    states: States;
    context?: ActorContext;
    initial: InitialState<States[number]>;
    clock?: Clock;
    effects?: Partial<
      Record<StateNames, Array<EffectFn<Inputs | Internal, Internal, ActorContext>>>
    >;
    transitions: Partial<
      Record<
        StateNames | "Any",
        Partial<{
          [Id in Inputs[number]["id"] | InternalNames]: (
            event: ById<Inputs[number] | Internal[number], Id>,
            options: { context: ActorContext; actor: AnyActor },
          ) => TransitionResult;
        }>
      >
    >;
    regions?: Record<string, AnyActor>;
  }) {
    this.options = {
      ...options,
      outputs: (options.outputs ?? []) as Outputs,
      internal: (options.internal ?? []) as Internal,
      context: options.context ?? ({} as ActorContext),
      effects: options.effects ?? ({} as typeof this.options.effects),
    };
    this.#internalIds = new Set(this.options.internal.map((e) => e.id));
    this.clock = options.clock ?? new RealClock();
    if (this.clock instanceof VirtualClock) {
      this.clock._setDrain(() => this.#processInternalQueue());
    }
    const init = resolveInitial(options.initial);
    this.state = init.state;
    this.#context = this.options.context;
    if (options.regions) {
      for (const [key, child] of Object.entries(options.regions)) {
        this.#regions[key] = child;
        child.__outputHandler = (event) => {
          this.#internalQueue.push(event);
          this.#processInternalQueue();
        };
      }
    }
    for (const [key, child] of Object.entries(this.#regions)) {
      this.#children.set(key, child);
    }
  }

  on(event: "change", fn: (snapshot: Snapshot) => void): () => void;
  on(event: "error", fn: (error: unknown) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  on(
    event: "change" | "error" | "done",
    fn: ((snapshot: Snapshot) => void) | ((error: unknown) => void) | (() => void),
  ): () => void {
    if (event === "change") {
      const cb = fn as (snapshot: Snapshot) => void;
      this.#subscribers.add(cb);
      cb(this.snapshot());
      return () => {
        this.#subscribers.delete(cb);
      };
    }
    if (event === "error") {
      const cb = fn as (error: unknown) => void;
      this.#errorSubscribers.add(cb);
      return () => {
        this.#errorSubscribers.delete(cb);
      };
    }
    if (event === "done") {
      const cb = fn as () => void;
      this.#doneSubscribers.add(cb);
      return () => {
        this.#doneSubscribers.delete(cb);
      };
    }
    return () => {};
  }

  settled(): Promise<void> {
    if (this.#internalQueue.length === 0 && !this.#processing) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#settledResolvers.push(resolve);
    });
  }

  send(event: Inputs[number] | { id: string; [key: string]: unknown }): void {
    const transitions = this.options.transitions as Record<
      string,
      Record<string, TransitionHandler<ActorContext> | undefined>
    >;
    const eventId = event.id as string;
    const stateTransition = transitions[this.state.name as string]?.[eventId];
    const anyTransition = transitions["Any"]?.[eventId];

    let transitionApplied = false;
    let anyEmitted = false;

    if (stateTransition) {
      const step = stateTransition(event, { context: this.#context, actor: this as AnyActor });
      if (step.state) {
        this.#applyTransition(event, step);
        transitionApplied = true;
      }
      if (step.emit) {
        this.#internalQueue.push(...step.emit);
      }
    }

    if (anyTransition) {
      const step = anyTransition(event, { context: this.#context, actor: this as AnyActor });
      if (step.state && !transitionApplied) {
        this.#applyTransition(event, step);
      }
      if (step.emit) {
        this.#internalQueue.push(...step.emit);
        anyEmitted = true;
      }
    }

    if (anyEmitted || this.#internalQueue.length > this.#queueIndex) {
      this.#processInternalQueue();
    }
  }

  #applyTransition(
    event: Inputs[number] | { id: string; [key: string]: unknown },
    step: TransitionResult,
  ): void {
    if (step.state) {
      this.#effectAbort?.abort();
      let payload: unknown;
      if (step.state instanceof TransitionStateClass) {
        payload = step.state.__payload;
        this.state = step.state.__stateRef as States[number];
      } else {
        this.state = step.state as States[number];
      }
      this.#runEffects(event, payload);
      for (const fn of this.#subscribers) {
        fn(this.snapshot());
      }
      if (this.state.isFinal) {
        for (const fn of this.#doneSubscribers) {
          fn();
        }
      }
    }
  }

  #runEffects(
    event: Inputs[number] | { id: string; [key: string]: unknown },
    statePayload: unknown,
  ): void {
    const allEffects = this.options.effects as Record<
      string,
      Array<EffectFn<Inputs, Internal, ActorContext>>
    >;
    const effects = allEffects[this.state.name];
    if (!effects) return;

    const abort = new AbortController();
    this.#effectAbort = abort;
    for (const effectFn of effects) {
      try {
        effectFn({
          signal: abort.signal,
          state: { name: this.state.name, payload: statePayload },
          event: event as Inputs[number] | Internal[number],
          context: this.#context,
          emit: (e: { id: string; [key: string]: unknown }) => {
            this.#internalQueue.push(e);
            this.#processInternalQueue();
          },
          clock: this.clock,
        });
      } catch (err) {
        for (const fn of this.#errorSubscribers) {
          try {
            fn(err);
          } catch {
            /* catch subscriber throw to avoid crash */
          }
        }
      }
    }

    this.#processInternalQueue();
  }

  #processInternalQueue(): void {
    if (this.#processing) return;
    this.#processing = true;
    while (this.#queueIndex < this.#internalQueue.length) {
      const event = this.#internalQueue[this.#queueIndex++];
      if (this.#internalIds.has(event.id)) {
        this.send(event);
      } else if (this.#outputHandler) {
        this.#outputHandler(event);
      }
    }
    this.#internalQueue.length = 0;
    this.#queueIndex = 0;
    this.#processing = false;
    if (this.#settledResolvers.length > 0) {
      const resolvers = this.#settledResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  snapshot(): Snapshot {
    return this.#snapshot(this.state);
  }

  #snapshot(s: AnyStateRef): Snapshot {
    const path = [s.name];
    const regions: Record<string, Snapshot> = {};

    if (s._regions) {
      for (const [regionName, region] of Object.entries(s._regions)) {
        const active = region.states[region.initial];
        if (active) {
          regions[regionName] = this.#snapshot(active);
        }
      }
    }

    for (const [regionName, child] of Object.entries(this.#regions)) {
      regions[regionName] = child.snapshot();
    }

    const snap: Snapshot = { path, regions };

    if (s.isFinal) {
      snap.done = true;
    }

    return snap;
  }
}

type CreatedEvent<E> = E extends EventRef<infer Id, infer P> ? P & { id: Id } : never;

type ById<T extends { id: string }, K extends T["id"]> = CreatedEvent<Extract<T, { id: K }>>;

type TransitionHandler<AC> = (
  event: AnyEventRef | { id: string; [key: string]: unknown },
  options: { context: AC; actor: AnyActor },
) => TransitionResult;

type TransitionResult = {
  state?: AnyStateRef | TransitionState<string, unknown>;
  emit?: Array<{ id: string }>;
};

type InitialState<S> =
  S extends StateRef<infer N extends string, infer P>
    ? unknown extends P
      ? S | TransitionState<N, P> | { state: S; payload?: P }
      : TransitionState<N, P> | { state: S; payload: P }
    : never;

export function isIn(snapshot: Snapshot, stateRefName: string): boolean {
  if (snapshot.path[0] === stateRefName) return true;
  for (const region of Object.values(snapshot.regions)) {
    if (isIn(region, stateRefName)) return true;
  }
  return false;
}

export function activeLeaves(snapshot: Snapshot): string[] {
  if (Object.keys(snapshot.regions).length === 0) {
    return [snapshot.path.join(".")];
  }
  const leaves: string[] = [];
  for (const [regionName, region] of Object.entries(snapshot.regions)) {
    for (const leaf of activeLeaves(region)) {
      leaves.push(`${snapshot.path[0]}.${regionName}.${leaf}`);
    }
  }
  return leaves;
}

function resolveInitial<S>(
  initial: InitialState<S>,
): S extends StateRef<infer N, infer P> ? { state: StateRef<N, P>; payload?: P } : never {
  if (initial instanceof TransitionStateClass) {
    return { state: initial.__stateRef, payload: initial.__payload } as ReturnType<
      typeof resolveInitial<S>
    >;
  }
  const result =
    typeof initial === "object" && initial !== null && "state" in initial
      ? initial
      : { state: initial };
  return result as ReturnType<typeof resolveInitial<S>>;
}
