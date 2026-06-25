import { StateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent } from "./event.ts";
import { IS_DEV } from "./utils.ts";
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

export { RealClock, VirtualClock };
export type { Clock, Snapshot, AnyActor };

type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Id, infer P> ? (P extends void ? { id: Id } : P & { id: Id }) : never;

type StateNameOf<S extends AnyStateRef> = S extends StateRef<infer N, any, any> ? N : never;
type EventIdOf<E extends AnyEventRef> = E extends EventRef<infer Id, any> ? Id : never;

export type TransitionMap<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext,
> = {
  [S in StateNameOf<States[number]> | "Any"]?: {
    [E in EventIdOf<Inputs[number]> | EventIdOf<Internal[number]> | string]?: (
      event: InternalEvent,
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
  ActorContext,
> {
  inputs: Inputs;
  outputs?: Outputs;
  internal?: Internal;
  states: States;
  context?: ActorContext;
  initial: InitialState<States[number]>;
  clock?: Clock;
  internalBudget?: number;
  effects?: EffectsMap<States, ActorContext>;
  transitions: TransitionMap<States, Inputs, Internal, Outputs, ActorContext>;
  regions?: Record<string, AnyActor>;
}

export class Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[],
  const Outputs extends readonly AnyEventRef[],
  ActorContext,
> {
  state: States[number];
  readonly clock: Clock;
  #context: ActorContext;
  #options: ActorOptions<States, Inputs, Internal, Outputs, ActorContext>;
  #regions: Record<string, AnyActor> = {};
  #children = new Map<string, AnyActor>();
  #queue = new InternalQueue();
  #subs = new Subscribers();
  #effectAbort: AbortController | null = null;
  #outputHandler: ((event: InternalEvent) => void) | null = null;
  #internalIds: Set<string>;
  #inputIds: Set<string>;
  #internalBudget: number;

  get context(): ActorContext {
    return this.#context;
  }

  get regions(): Record<string, AnyActor> {
    return this.#regions;
  }

  get options(): ActorOptions<States, Inputs, Internal, Outputs, ActorContext> {
    return this.#options;
  }

  constructor(options: ActorOptions<States, Inputs, Internal, Outputs, ActorContext>) {
    this.#options = options;
    const internal = options.internal ?? ([] as unknown as Internal);
    this.#internalIds = new Set(internal.map((e) => e.id));
    this.#inputIds = new Set(options.inputs.map((e) => e.id));
    this.#internalBudget = options.internalBudget ?? 10_000;
    this.clock = options.clock ?? new RealClock();
    this.clock.setDrain?.(() => this.#drainInternal());

    const initState = resolveInitial(options.initial);
    if (IS_DEV) {
      const stateNames = new Set(options.states.map((s) => s.name));
      if (!stateNames.has(initState.name)) {
        console.warn(
          `[Actor] initial state "${initState.name}" not found in declared states [${[...stateNames].join(", ")}]`,
        );
      }
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
  on(event: "error", fn: (error: unknown) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  on(
    event: "change" | "error" | "done",
    fn: ((snapshot: Snapshot) => void) | ((error: unknown) => void) | (() => void),
  ): () => void {
    if (event === "change") {
      const cb = fn as (snapshot: Snapshot) => void;
      this.#subs.change.add(cb);
      cb(this.snapshot());
      return () => this.#subs.change.delete(cb);
    }
    if (event === "error") {
      const cb = fn as (error: unknown) => void;
      this.#subs.error.add(cb);
      return () => this.#subs.error.delete(cb);
    }
    const cb = fn as () => void;
    this.#subs.done.add(cb);
    return () => this.#subs.done.delete(cb);
  }

  settled(): Promise<void> {
    return this.#queue.settled();
  }

  send(event: CreatedOf<Inputs[number]> | CreatedOf<Internal[number]>): void {
    if (this.state.isFinal) {
      console.warn(
        `[Actor] cannot send "${event.id}" — current state "${this.state.name}" is final.`,
      );
      return;
    }
    const transitions = this.#options.transitions as unknown as TransitionDispatch<ActorContext>;
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
    } else if (IS_DEV && !stateTransition && !anyTransition) {
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
    const effects = (this.#options.effects ?? {}) as Record<string, Array<EffectFn<ActorContext>>>;
    const list = effects[this.state.name];
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
      onError: (err) => this.#subs.emitError(err),
    });
    this.#effectAbort = abort;
  }

  #drainInternal(): void {
    const budget = this.#internalBudget;
    let count = 0;
    this.#queue.processCancellable((event) => {
      if (count >= budget) {
        this.#subs.emitError(
          new Error(
            `[Actor] internal event budget (${budget}) exceeded — possible emit loop. Actor halting.`,
          ),
        );
        this.__abortEffects();
        return false;
      }
      count++;
      if (this.#internalIds.has(event.id)) {
        this.send(event as CreatedOf<Internal[number]>);
      } else if (this.#inputIds.has(event.id)) {
        this.send(event as CreatedOf<Inputs[number]>);
      } else if (this.#outputHandler) {
        this.#outputHandler(event);
      }
      return true;
    });
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
