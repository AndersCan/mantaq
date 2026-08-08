import { StateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import { RealClock } from "./real-clock.ts";
import { VirtualClock } from "./virtual-clock.ts";
import type { Clock } from "./clock.ts";
import type { Snapshot } from "./actor-internal.ts";
import type { AnyActor } from "./actor-internal.ts";
import { InternalQueue } from "./queue.ts";
import { Subscribers } from "./subscribers.ts";
import { buildSnapshot } from "./snapshot.ts";
import { runEffects } from "./effects.ts";
import { parseTarget } from "./dispatch.ts";
import type { EffectFn, TransitionResult } from "./actor-types.ts";
import { ActorBuilder } from "./builder.ts";
import type { SetupFn } from "./builder.ts";

export { RealClock, VirtualClock };
export type { Clock, Snapshot, AnyActor };

type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Id, infer P> ? (P extends void ? { id: Id } : P & { id: Id }) : never;

type StateNameOf<S extends AnyStateRef> = S extends StateRef<infer N, unknown, boolean> ? N : never;
type EventIdOf<E extends AnyEventRef> = E extends EventRef<infer Id, object | void> ? Id : never;

type CreatedForId<Refs extends readonly AnyEventRef[], Id extends string> =
  Extract<Refs[number], { id: Id }> extends infer R
    ? R extends EventRef<Id, infer P>
      ? CreatedOfEvent<Id, P>
      : never
    : never;

type HandlerEvent<
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Id extends string,
> = CreatedForId<Inputs, Id> | CreatedForId<Internal, Id>;

export type TransitionMap<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = {
  [S in StateNameOf<States[number]> | "Any"]?: {
    [E in EventIdOf<Inputs[number]> | EventIdOf<Internal[number]>]?: (
      event: HandlerEvent<Inputs, Internal, E>,
      options: { context: ActorContext; actor: AnyActor },
    ) => TransitionResult<States[number], EventIdOf<Outputs[number]>>;
  };
};

export type EffectsMap<States extends readonly AnyStateRef[], ActorContext> = Partial<
  Record<StateNameOf<States[number]>, Array<EffectFn<ActorContext>>>
>;

type InitialState<S extends AnyStateRef> =
  S extends StateRef<infer _N extends string, infer P>
    ? [unknown] extends [P]
      ? S | { state: S; payload?: P }
      : { state: S; payload: P }
    : never;

function resolveInitial<S extends AnyStateRef>(initial: InitialState<S>): S {
  const result =
    typeof initial === "object" && initial !== null && "state" in initial ? initial.state : initial;
  return result as S;
}

export interface ActorOptions<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext = Record<string, unknown>,
> {
  inputs: Inputs;
  outputs?: Outputs;
  internal?: Internal;
  states: States;
  context?: ActorContext;
  initial: InitialState<States[number]>;
  clock?: Clock;
  internalBudget?: number;
  setup: SetupFn<States, Inputs, Internal, Outputs, ActorContext>;
  regions?: Record<string, AnyActor>;
}

export interface InternalActorOptions<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext = Record<string, unknown>,
> {
  inputs: Inputs;
  outputs?: Outputs;
  internal?: Internal;
  states: States;
  context?: ActorContext;
  initial: InitialState<States[number]>;
  clock?: Clock;
  internalBudget?: number;
  transitions: TransitionDispatch<ActorContext>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
  regions?: Record<string, AnyActor>;
}

export class Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly AnyEventRef[],
  ActorContext = Record<string, unknown>,
> {
  state: States[number];
  readonly clock: Clock;
  #context: ActorContext;
  #options: InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext>;
  #regions: Record<string, AnyActor> = {};
  #children = new Map<string, AnyActor>();
  #queue = new InternalQueue();
  #subs = new Subscribers();
  #effectAbort: AbortController | null = null;
  #outputHandler: ((event: InternalEvent) => void) | null = null;
  #internalIds: Set<string>;
  #inputIds: Set<string>;
  #internalBudget: number;
  #draining = false;

  get context(): ActorContext {
    return this.#context;
  }

  get regions(): Record<string, AnyActor> {
    return this.#regions;
  }

  get options(): InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext> {
    return this.#options;
  }

  constructor(options: ActorOptions<States, Inputs, Internal, Outputs, ActorContext>) {
    const builder = new ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>();
    options.setup(builder);
    const built = builder.build();

    this.#options = {
      ...options,
      transitions: built.transitions,
      effects: built.effects,
    };

    this.#internalIds = new Set((options.internal ?? []).map((e) => e.id));
    this.#inputIds = new Set(options.inputs.map((e) => e.id));
    this.#internalBudget = options.internalBudget ?? 10_000;
    this.clock = options.clock ?? new RealClock();
    this.clock.setDrain?.(() => this.#drainInternal());

    const initState = resolveInitial(options.initial);
    const stateNames = new Set(options.states.map((s) => s.name));
    if (!stateNames.has(initState.name)) {
      console.warn(
        `[Actor] initial state "${initState.name}" not found in declared states [${[...stateNames].join(", ")}]`,
      );
    }
    this.state = initState;
    this.#context = (options.context ?? {}) as ActorContext;

    if (options.regions) {
      for (const [key, child] of Object.entries(options.regions)) {
        this.#regions[key] = child;
        child.__outputHandler = (event) => {
          this.#queue.push(event);
          this.#drainInternal();
        };
        this.#children.set(key, child);
      }
    }
  }

  on(event: "change", fn: (snapshot: Snapshot) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  on(event: "change" | "done", fn: ((snapshot: Snapshot) => void) | (() => void)): () => void {
    if (event === "change") {
      const cb = fn as (snapshot: Snapshot) => void;
      this.#subs.change.add(cb);
      cb(this.snapshot());
      return () => this.#subs.change.delete(cb);
    }
    const cb = fn as () => void;
    this.#subs.done.add(cb);
    return () => this.#subs.done.delete(cb);
  }

  settled(): Promise<void> {
    return this.#queue.settled();
  }

  send(event: CreatedOf<Inputs[number]>): void {
    this.#dispatch(event);
  }

  #dispatch(event: InternalEvent): void {
    if (this.state.isFinal) return;
    const transitions = this.#options.transitions;
    const stateTransition = transitions[this.state.name]?.[event.id];
    const anyTransition = transitions["Any"]?.[event.id];

    let transitionApplied = false;
    let anyEmitted = false;

    if (stateTransition) {
      const step = stateTransition(event, { context: this.#context, actor: this as AnyActor });
      if (step.emit) this.#queue.push(...step.emit);
      if (step.state) {
        this.#applyTransition(event, step);
        transitionApplied = true;
      }
    }

    if (anyTransition) {
      const step = anyTransition(event, { context: this.#context, actor: this as AnyActor });
      if (step.state && !transitionApplied) {
        this.#applyTransition(event, step);
      }
      if (step.emit) {
        this.#queue.push(...step.emit);
        anyEmitted = true;
      }
    }

    if (anyEmitted || this.#queue.length > 0) {
      this.#drainInternal();
    } else if (!stateTransition && !anyTransition) {
      console.warn(
        `[Actor] no transition for event "${event.id}" in state "${this.state.name}". Event dropped.`,
      );
    }
  }

  snapshot(): Snapshot {
    return buildSnapshot(this.state, this.#regions);
  }

  /** @internal */ get __children(): Map<string, AnyActor> {
    return this.#children;
  }
  /** @internal */ get __outputHandler(): ((event: InternalEvent) => void) | null {
    return this.#outputHandler;
  }
  /** @internal */ set __outputHandler(fn: ((event: InternalEvent) => void) | null) {
    this.#outputHandler = fn;
  }
  /** @internal */ __pushInternal(event: InternalEvent): void {
    this.#queue.push(event);
  }
  /** @internal */ __drainInternal(): void {
    this.#drainInternal();
  }
  /** @internal */ __abortEffects(): void {
    this.#effectAbort?.abort();
    this.#subs.clear();
  }

  #applyTransition<AllowedState extends AnyStateRef>(
    event: InternalEvent,
    step: TransitionResult<AllowedState, string>,
  ): void {
    if (!step.state) return;
    this.#effectAbort?.abort();
    const resolved = parseTarget<AllowedState>(step);
    if (!resolved) return;
    this.state = resolved.state as States[number];
    this.#runEffects(event, resolved.payload);
    this.#subs.emitChange(this.snapshot());
    if (this.state.isFinal) {
      this.#subs.emitDone();
    }
  }

  #runEffects(event: InternalEvent, statePayload: unknown): void {
    const list = this.#options.effects[this.state.name];
    if (!list || list.length === 0) {
      this.#effectAbort = null;
      return;
    }
    const abort = runEffects<ActorContext>({
      effects: { [this.state.name]: list },
      state: this.state,
      statePayload,
      event,
      context: this.#context,
      emit: (e: InternalEvent) => {
        this.#queue.push(e);
        this.#drainInternal();
      },
      clock: this.clock,
    });
    this.#effectAbort = abort;
  }

  #drainInternal(): void {
    if (this.#draining) return;
    this.#draining = true;
    let budgetExceeded = false;
    try {
      const budget = this.#internalBudget;
      let count = 0;
      this.#queue.processCancellable((event) => {
        if (count >= budget) {
          budgetExceeded = true;
          this.__abortEffects();
          return false;
        }
        count++;
        if (this.#internalIds.has(event.id)) {
          this.#dispatch(event);
        } else if (this.#inputIds.has(event.id)) {
          this.#dispatch(event);
        } else if (this.#outputHandler) {
          this.#outputHandler(event);
        }
        return true;
      });
    } finally {
      this.#draining = false;
    }
    if (budgetExceeded) {
      console.warn(
        `[Actor] internal event budget (${this.#internalBudget}) exceeded — possible emit loop. Actor halting.`,
      );
    }
  }
}

type TransitionDispatch<ActorContext> = Record<
  string,
  Record<
    string,
    | ((
        event: InternalEvent,
        options: { context: ActorContext; actor: AnyActor },
      ) => TransitionResult)
    | undefined
  >
>;
