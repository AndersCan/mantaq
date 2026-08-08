import { StateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent } from "./event.ts";
import { RealClock } from "./real-clock.ts";
import { VirtualClock } from "./virtual-clock.ts";
import type { Clock } from "./clock.ts";
import type { Snapshot, AnyActor } from "./actor-internal.ts";
import { registerActor, setOutputHandler } from "./internal-registry.ts";
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

type InitialState<S extends AnyStateRef> =
  S extends StateRef<infer _N extends string, infer P>
    ? [unknown] extends [P]
      ? S | { state: S; payload?: P }
      : { state: S; payload: P }
    : never;

function pickState<S extends AnyStateRef>(initial: S | { state: S }): S {
  return initial instanceof StateRef ? initial : initial.state;
}

function resolveInitial<S extends AnyStateRef>(initial: InitialState<S>): S {
  return pickState<S>(initial);
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
  transitions: TransitionDispatch<States, ActorContext>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
  regions?: Record<string, AnyActor>;
}

type TransitionDispatch<States extends readonly AnyStateRef[], ActorContext> = Record<
  string,
  Record<
    string,
    | ((
        event: InternalEvent,
        options: { context: ActorContext; actor: AnyActor },
      ) => TransitionResult<States[number], string>)
    | undefined
  >
>;

type StepFn<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  options: { context: ActorContext; actor: AnyActor },
) => TransitionResult<States[number], string>;

export class Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
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
    registerActor(this, {
      children: this.#children,
      getOutputHandler: () => this.#outputHandler,
      setOutputHandler: (fn) => {
        this.#outputHandler = fn;
      },
      pushInternal: (event) => this.#pushEvent(event),
      drainInternal: () => this.#drainInternal(),
      abortEffects: () => this.#abortEffects(),
    });

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
        const result = setOutputHandler(child, (event) => {
          this.#queue.push(event);
          this.#drainInternal();
        });
        if (result[0] !== undefined) {
          console.error(result[0].message);
        }
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

    const transitionApplied = stateTransition
      ? this.#applyStateStep(event, stateTransition)
      : false;
    const anyEmitted = anyTransition
      ? this.#applyAnyStep(event, anyTransition, !transitionApplied)
      : false;

    if (anyEmitted || this.#queue.length > 0) {
      this.#drainInternal();
    } else if (!stateTransition && !anyTransition) {
      console.warn(
        `[Actor] no transition for event "${event.id}" in state "${this.state.name}". Event dropped.`,
      );
    }
  }

  #applyStateStep(event: InternalEvent, transition: StepFn<States, ActorContext>): boolean {
    const step = transition(event, { context: this.#context, actor: this as AnyActor });
    if (step.emit) this.#queue.push(...step.emit);
    if (step.state) {
      this.#applyTransition(event, step);
      return true;
    }
    return false;
  }

  #applyAnyStep(
    event: InternalEvent,
    transition: StepFn<States, ActorContext>,
    allowTransition: boolean,
  ): boolean {
    const step = transition(event, { context: this.#context, actor: this as AnyActor });
    if (step.state && allowTransition) {
      this.#applyTransition(event, step);
    }
    if (step.emit) {
      this.#queue.push(...step.emit);
      return true;
    }
    return false;
  }

  snapshot(): Snapshot {
    return buildSnapshot(this.state, this.#regions);
  }

  #pushEvent(event: InternalEvent): void {
    this.#queue.push(event);
  }

  #abortEffects(): void {
    this.#effectAbort?.abort();
    this.#subs.clear();
  }

  #applyTransition(event: InternalEvent, step: TransitionResult<States[number], string>): void {
    if (!step.state) return;
    this.#effectAbort?.abort();
    const resolved = parseTarget<States[number]>(step);
    if (!resolved) return;
    this.state = resolved.state;
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
          this.#abortEffects();
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
