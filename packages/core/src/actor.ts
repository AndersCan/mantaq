import type { AnyStateRef, StateRef } from "./state.ts";
import type { AnyEventRef } from "./event.ts";

export interface Snapshot {
  path: string[];
  regions: Record<string, Snapshot>;
}

export interface Clock {
  setTimeout(ms: number, cb: () => void): number;
  clearTimeout(id: number): void;
}

class RealClock implements Clock {
  setTimeout(ms: number, cb: () => void): number {
    return globalThis.setTimeout(cb, ms) as unknown as number;
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id);
  }
}

export class VirtualClock implements Clock {
  private _now = 0;
  private _timers: Map<number, { deadline: number; cb: () => void }> = new Map();
  private _nextId = 1;
  private _drain: (() => void) | null = null;

  now(): number {
    return this._now;
  }

  setTimeout(ms: number, cb: () => void): number {
    const id = this._nextId++;
    this._timers.set(id, { deadline: this._now + ms, cb });
    return id;
  }

  clearTimeout(id: number): void {
    this._timers.delete(id);
  }

  advance(ms: number): void {
    this._now += ms;
    const due = [...this._timers.entries()]
      .filter(([, t]) => t.deadline <= this._now)
      .sort((a, b) => a[1].deadline - b[1].deadline);
    for (const [id] of due) {
      this._timers.delete(id);
    }
    for (const [, t] of due) {
      t.cb();
    }
    this._drain?.();
  }

  hasPending(): boolean {
    return this._timers.size > 0;
  }

  /** @internal */
  _setDrain(fn: () => void): void {
    this._drain = fn;
  }
}

/**
 * Convert A | B to A & B
 */
type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any
  ? R
  : never;

export type EffectFn<Outputs extends AnyEventRef[], ActorContext> = (options: {
  signal: AbortSignal;
  payload: unknown;
  context: ActorContext;
  emit: (event: ReturnType<Outputs[number]["create"]>) => void;
  clock: Clock;
}) => void;

export class Actor<
  const Inputs extends AnyEventRef[],
  const Outputs extends AnyEventRef[],
  const Internal extends AnyEventRef[],
  const States extends AnyStateRef[],
  const InputNames extends Inputs[number]["id"],
  const InternalNames extends Internal[number]["id"],
  const StateNames extends States[number]["name"],
  const ActorContext extends UnionToIntersection<NonNullable<States[number]["__payload"]>>,
> {
  state: States[number];
  context: ActorContext;
  clock: Clock;
  _regionState: Map<string, AnyStateRef> = new Map();
  _internalQueue: Array<{ id: string; [key: string]: unknown }> = [];
  _effectAbort: AbortController | null = null;

  options: {
    inputs: Inputs;
    outputs: Outputs;
    internal: Internal;
    states: States;
    context: ActorContext;
    initial: InitialState<States[number]>;
    effects: Partial<Record<StateNames, Array<EffectFn<Internal | Outputs, ActorContext>>>>;
    transitions: Partial<
      Record<
        StateNames,
        Partial<{
          [Id in Inputs[number]["id"] | InternalNames]: (
            event: ById<Inputs[number] | Internal[number], Id>,
          ) => TransitionResult;
        }>
      >
    >;
  };

  constructor(options: {
    inputs: Inputs;
    outputs: Outputs;
    internal: Internal;
    states: States;
    context: ActorContext;
    initial: InitialState<States[number]>;
    clock?: Clock;
    effects: Partial<Record<StateNames, Array<EffectFn<Internal | Outputs, ActorContext>>>>;
    // todo: Support Inputs[number]["id"] - for Events that should run regardless of state (ex: ForceKill)
    transitions: Partial<
      Record<
        StateNames,
        Partial<{
          [Id in Inputs[number]["id"] | InternalNames]: (
            event: ById<Inputs[number] | Internal[number], Id>,
          ) => TransitionResult;
        }>
      >
    >;
  }) {
    this.options = options;
    this.clock = options.clock ?? new RealClock();
    if (this.clock instanceof VirtualClock) {
      this.clock._setDrain(() => this._processInternalQueue());
    }
    const init = resolveInitial(options.initial);
    this.state = init.state;
    this.context = options.context;
    this._initRegionState(init.state);
  }

  private _initRegionState(s: AnyStateRef) {
    if (s._regions) {
      for (const [key, region] of Object.entries(s._regions)) {
        const initial = region.states[region.initial as string];
        if (initial) {
          this._regionState.set(`${s.name}.${key}`, initial);
          this._initRegionState(initial);
        }
      }
    }
  }

  send(event: Inputs[number] | { id: string; [key: string]: unknown }): void {
    const transition =
      this.options.transitions?.[this.state.name as StateNames]?.[
        event.id as InputNames | InternalNames
      ];

    if (transition) {
      const step = transition(event as any);

      if (step.state) {
        this._effectAbort?.abort();
        this.state = step.state;
        this._runEffects(event);
      }

      if (step.emit) {
        this._internalQueue.push(...(step.emit as Array<{ id: string; [key: string]: unknown }>));
        this._processInternalQueue();
      }
    }
  }

  private _runEffects(event: Inputs[number] | { id: string; [key: string]: unknown }) {
    const effects = this.options.effects?.[this.state.name as StateNames];
    if (!effects) return;

    const abort = new AbortController();
    this._effectAbort = abort;
    for (const effectFn of effects) {
      effectFn({
        signal: abort.signal,
        payload: event.payload,
        context: this.context,
        emit: (e) => this._internalQueue.push(e),
        clock: this.clock,
      });
    }

    this._processInternalQueue();
  }

  private _processInternalQueue(): void {
    while (this._internalQueue.length > 0) {
      const event = this._internalQueue.shift()!;
      if (this.options.internal.some((e) => e.id === event.id)) {
        this.send(event as unknown as Internal[number]);
      }
      // Output events are broadcast externally (not processed internally)
    }
  }

  snapshot(): Snapshot {
    return this._snapshot(this.state);
  }

  private _snapshot(s: AnyStateRef): Snapshot {
    const path = [s.name];
    const regions: Record<string, Snapshot> = {};

    if (s._regions) {
      for (const [regionName, region] of Object.entries(s._regions)) {
        const key = `${s.name}.${regionName}`;
        const active = this._regionState.get(key) ?? region.states[region.initial as string];
        if (active) {
          regions[regionName] = this._snapshot(active);
        }
      }
    }

    return { path, regions };
  }
}

type ById<T extends { id: string }, K extends T["id"]> = Extract<T, { id: K }>;

type TransitionResult = {
  state?: AnyStateRef;
  payload?: unknown;
  emit?: unknown[];
};

type InitialState<S> =
  S extends StateRef<infer _N, infer P>
    ? unknown extends P
      ? S | { state: S; payload?: P }
      : { state: S; payload: P }
    : never;

function resolveInitial<S>(
  initial: InitialState<S>,
): S extends StateRef<infer N, infer P> ? { state: StateRef<N, P>; payload?: P } : never {
  return (
    typeof initial === "object" && initial !== null && "state" in initial
      ? initial
      : { state: initial }
  ) as any;
}
