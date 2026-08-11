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
import type {
  EffectFn,
  ErrorInfo,
  ErrorReason,
  ErrorState,
  LastKnownState,
  TransitionResult,
} from "./actor-types.ts";
import { Context } from "./context.ts";
import { ActorBuilder } from "./builder.ts";
import type { SetupFn } from "./builder.ts";
import { Either } from "@mantaq/utils";

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

function resolveInitial<S extends AnyStateRef>(initial: S | { state: S }): S {
  return initial instanceof StateRef ? initial : initial.state;
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
> extends Omit<ActorOptions<States, Inputs, Internal, Outputs, ActorContext>, "setup"> {
  transitions: TransitionDispatch<States, ActorContext>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
}

type TransitionDispatch<States extends readonly AnyStateRef[], ActorContext> = Record<
  string,
  Record<
    string,
    | ((
        event: InternalEvent,
        options: { context: Context<ActorContext>; actor: AnyActor },
      ) => TransitionResult<States[number], string>)
    | undefined
  >
>;

type StepFn<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  options: { context: Context<ActorContext>; actor: AnyActor },
) => TransitionResult<States[number], string>;

export class Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
> {
  state: States[number] | ErrorState;
  readonly clock: Clock;
  #context: ActorContext;
  #contextHandle: Context<ActorContext>;
  #contextWritten = false;
  #lastState: AnyStateRef;
  #options: InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext>;
  #regions: Record<string, AnyActor> = {};
  #children = new Map<string, AnyActor>();
  #queue = new InternalQueue();
  #subs = new Subscribers<ActorContext>();
  #effectAbort: AbortController | null = null;
  #outputHandler: ((event: InternalEvent) => void) | null = null;
  #internalIds: Set<string>;
  #inputIds: Set<string>;
  #internalBudget: number;
  #draining = false;
  #errorState = new StateRef<"__error", unknown, false>("__error", false);
  #error: ErrorInfo | null = null;
  #entry: LastKnownState | null = null;
  #pendingEffects: Array<Promise<void>> = [];

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
      pushInternal: (event) => this.#queue.push(event),
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
    this.#lastState = initState;
    this.#contextHandle = new Context<ActorContext>(
      () => this.#context,
      (value: ActorContext) => {
        this.#context = value;
        this.#contextWritten = true;
      },
    );
    this.#subs.seed(this.snapshot());

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

  on(
    event: "change",
    fn: (snapshot: Snapshot<ActorContext>, prev: Snapshot<ActorContext>) => void,
  ): () => void;
  on(event: "done", fn: () => void): () => void;
  on(
    event: "change" | "done",
    fn: ((snapshot: Snapshot<ActorContext>, prev: Snapshot<ActorContext>) => void) | (() => void),
  ): () => void {
    if (event === "change") {
      const cb = fn as (snapshot: Snapshot<ActorContext>, prev: Snapshot<ActorContext>) => void;
      return this.#subs.addChange(cb);
    }
    const cb = fn as () => void;
    return this.#subs.addDone(cb);
  }

  settled(): Promise<void> {
    return Promise.all([this.#queue.settled(), ...this.#pendingEffects]).then(() => undefined);
  }

  send(event: CreatedOf<Inputs[number]>): void {
    this.#dispatch(event);
    this.#emitChangeIfDirty();
  }

  #emitChangeIfDirty(): void {
    if (this.state === this.#lastState && !this.#contextWritten) return;
    this.#lastState = this.state;
    this.#contextWritten = false;
    this.#subs.emitChange(this.snapshot());
  }

  #dispatch(event: InternalEvent): void {
    if (this.#error !== null || this.state.isFinal) return;
    const prev = this.#entry;
    this.#entry = { state: this.state, context: this.#context };
    try {
      const transitions = this.#options.transitions;
      const stateTransition = transitions[this.state.name]?.[event.id];
      const anyTransition = transitions["Any"]?.[event.id];
      const transitionApplied = stateTransition
        ? this.#applyStateStep(event, stateTransition)
        : false;
      const anyEmitted =
        this.#error === null ? this.#applyAnyStep(event, anyTransition, !transitionApplied) : false;
      if (anyEmitted || this.#queue.length > 0) {
        this.#drainInternal();
      } else if (!stateTransition && !anyTransition) {
        console.warn(
          `[Actor] no transition for event "${event.id}" in state "${this.state.name}". Event dropped.`,
        );
      }
    } finally {
      this.#entry = prev;
    }
  }

  #safe(reason: ErrorReason, event: InternalEvent, fn: () => void): boolean {
    const attempt = Either.from(fn);
    if (attempt[0] === undefined) return true;
    this.#enterError(reason, event, attempt[0]);
    return false;
  }

  #applyStateStep(event: InternalEvent, transition: StepFn<States, ActorContext>): boolean {
    let applied = false;
    this.#safe("transition", event, () => {
      const step = transition(event, { context: this.#contextHandle, actor: this as AnyActor });
      if (step.emit) this.#queue.push(...step.emit);
      if (step.state) {
        this.#applyTransition(event, step);
        applied = true;
      }
    });
    return applied;
  }

  #applyAnyStep(
    event: InternalEvent,
    transition: StepFn<States, ActorContext> | undefined,
    allowTransition: boolean,
  ): boolean {
    if (transition === undefined) return false;
    let emitted = false;
    this.#safe("transition", event, () => {
      const step = transition(event, { context: this.#contextHandle, actor: this as AnyActor });
      if (step.state && allowTransition) {
        this.#applyTransition(event, step);
      }
      if (step.emit) {
        this.#queue.push(...step.emit);
        emitted = true;
      }
    });
    return emitted;
  }

  snapshot(): Snapshot<ActorContext> {
    return buildSnapshot(this.state, this.#regions, this.#context, this.#error ?? undefined);
  }

  #abortEffects(): void {
    this.#effectAbort?.abort();
    this.#subs.clear();
  }

  #applyTransition(event: InternalEvent, step: TransitionResult<States[number], string>): void {
    if (this.#error !== null) return;
    if (!step.state) return;
    const resolved = parseTarget<States[number]>(step);
    if (!resolved) return;
    if (!(resolved.state instanceof StateRef)) {
      this.#enterError("transition", event, new Error("invalid transition target"));
      return;
    }
    this.#effectAbort?.abort();
    this.state = resolved.state;
    this.#runEffects(event, resolved.payload);
    if (this.state.isFinal) {
      this.#subs.emitDone();
    }
  }

  #runEffects(event: InternalEvent, statePayload: unknown): void {
    const list = this.#options.effects[this.state.name];
    if (!list) {
      this.#effectAbort = null;
      return;
    }
    const abort = new AbortController();
    this.#effectAbort = abort;
    const lastGood: LastKnownState = this.#entry ?? { state: this.state, context: this.#context };
    const result = runEffects<ActorContext>({
      effects: { [this.state.name]: list },
      state: this.state,
      statePayload,
      event,
      context: this.#contextHandle,
      emit: (e: InternalEvent) => {
        if (this.#error !== null) return;
        this.#queue.push(e);
        this.#drainInternal();
      },
      clock: this.clock,
      abort,
      lastGood,
      onError: (error: unknown) => this.#enterError("effect", event, error, lastGood),
    });
    this.#pendingEffects.push(...result.pending);
  }

  #enterError(
    reason: ErrorReason,
    event: InternalEvent,
    error: unknown,
    lastGood?: LastKnownState,
  ): void {
    if (this.#error !== null) return;
    const entry = lastGood ?? this.#entry ?? { state: this.state, context: this.#context };
    this.#error = { error, state: entry.state, context: entry.context, event, reason };
    this.#effectAbort?.abort();
    this.state = this.#errorState;
    this.#lastState = this.#errorState;
    this.#contextWritten = false;
    this.#subs.emitChange(this.snapshot());
  }

  #drainInternal(): void {
    if (this.#draining) return;
    this.#draining = true;
    try {
      const budget = this.#internalBudget;
      let count = 0;
      this.#queue.processCancellable((event) => {
        if (this.#error !== null) return false;
        if (count >= budget) {
          this.#enterError("budget", event, new Error("internal event budget exceeded"));
          return false;
        }
        count++;
        if (this.#internalIds.has(event.id) || this.#inputIds.has(event.id)) {
          this.#dispatch(event);
        } else {
          const outputHandler = this.#outputHandler;
          if (outputHandler) {
            if (!this.#safe("output", event, () => outputHandler(event))) return false;
          }
        }
        return true;
      });
    } finally {
      this.#draining = false;
      this.#emitChangeIfDirty();
    }
  }
}
