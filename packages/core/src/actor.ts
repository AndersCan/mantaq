import { StateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import type { AnyEventRef, EventRef, InternalEvent, CreatedOfEvent } from "./event.ts";
import { RealClock } from "./real-clock.ts";
import { VirtualClock } from "./virtual-clock.ts";
import type { Clock } from "./clock.ts";
import type { Snapshot, AnyActor } from "./actor-internal.ts";
import { InternalQueue } from "./queue.ts";
import { Subscribers } from "./subscribers.ts";
import { buildSnapshot } from "./snapshot.ts";
import { runEffects } from "./effects.ts";
import { parseTarget } from "./dispatch.ts";
import { Context } from "./context.ts";
import { ActorBuilder } from "./builder.ts";
import type { SetupFn } from "./builder.ts";
import type {
  EffectFn,
  ErrorInfo,
  ErrorReason,
  ErrorState,
  LastKnownState,
  TransitionInfo,
  TransitionResult,
} from "./actor-types.ts";

export { RealClock, VirtualClock };
export type { Clock, Snapshot, AnyActor };

import { Either } from "@mantaq/utils";

type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never;

export type InitialState<S extends AnyStateRef> =
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

type SubscriberEvent = "change" | "done" | "transition" | "error" | "output";

type SubscriberFns<C> = {
  change: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void;
  done: () => void;
  transition: (info: TransitionInfo) => void;
  error: (info: ErrorInfo) => void;
  output: (event: InternalEvent) => void;
};

type SubscriberCase<C> = {
  [K in SubscriberEvent]: (fn: SubscriberFns<C>[K]) => () => void;
};

interface StepOutcome {
  emitted: boolean;
  transitioned: boolean;
  target?: string;
}

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

  #queue = new InternalQueue();

  #subs = new Subscribers<ActorContext>();

  #effectAbort: AbortController | null = null;

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

    this.#options = { ...options, transitions: built.transitions, effects: built.effects };

    this.#internalIds = new Set((options.internal ?? []).map((e) => e.type));
    this.#inputIds = new Set(options.inputs.map((e) => e.type));
    this.#internalBudget = options.internalBudget ?? 10_000;
    this.clock = options.clock ?? new RealClock();
    this.clock.setDrain?.(() => this.#drainInternal());

    const initState = resolveInitial(options.initial);
    const stateNames = new Set(options.states.map((s) => s.name));
    if (!stateNames.has(initState.name)) {
      throw new Error(
        `[Actor] initial state "${initState.name}" not found in declared states [${[...stateNames].join(", ")}]`,
      );
    }
    this.state = initState;
    this.#statePayload = options.initial instanceof StateRef ? undefined : options.initial.payload;
    this.#context = (options.context ?? {}) as ActorContext;
    this.#lastState = initState;
    this.#contextHandle = new Context<ActorContext>(
      () => this.#context,
      (value: ActorContext) => {
        this.#context = value;
        this.#contextWritten = true;
      },
    );

    if (options.regions) {
      for (const [key, child] of Object.entries(options.regions)) {
        this.#regions[key] = child;
        child.on("output", (event) => {
          this.#queue.push(event);
          this.#drainInternal();
        });
      }
    }

    // Enter the initial state like any other entry: run effects, then seed.
    this.#runEffects({ type: "__init" }, this.#statePayload);
    this.#subs.seed(this.snapshot());
  }

  on(
    event: "change",
    fn: (snapshot: Snapshot<ActorContext>, prev: Snapshot<ActorContext>) => void,
  ): () => void;
  on(event: "done", fn: () => void): () => void;
  on(event: "transition", fn: (info: TransitionInfo) => void): () => void;
  on(event: "error", fn: (info: ErrorInfo) => void): () => void;
  on(event: "output", fn: (event: InternalEvent) => void): () => void;
  on<E extends SubscriberEvent>(event: E, fn: SubscriberFns<ActorContext>[E]): () => void {
    const dispatch: SubscriberCase<ActorContext> = {
      change: (fn) => this.#subs.addChange(fn),
      done: (fn) => this.#subs.addDone(fn),
      transition: (fn) => this.#subs.addTransition(fn),
      error: (fn) => this.#subs.addError(fn),
      output: (fn) => this.#subs.addOutput(fn),
    };
    return dispatch[event](fn);
  }

  settled(): Promise<void> {
    return Promise.all([this.#queue.settled(), ...this.#pendingEffects]).then(() => undefined);
  }

  send(event: CreatedOf<Inputs[number]>): void {
    if (this.#disposed) return;
    this.#dispatch(event);
    this.#emitChangeIfDirty();
  }

  /**
   * Restore a live state after `__error`. DANGER: caller supplies state+context,
   * breaking determinism. Effects not re-run; processing resumes on next event.
   */
  recover(target: { state: States[number]; context: ActorContext }): void {
    if (this.#error === null || this.#disposed) return;
    this.#effectAbort?.abort();
    this.#effectAbort = null;
    this.#queue.clear();
    this.#queue = new InternalQueue();
    this.#error = null;
    this.state = target.state;
    this.#statePayload = undefined;
    this.#context = target.context;
    this.#lastState = target.state;
    this.#contextWritten = false;
    this.#entry = null;
    this.#pendingEffects = [];
    this.#subs.emitChange(this.snapshot());
  }

  #emitChangeIfDirty(): void {
    if (this.state === this.#lastState && !this.#contextWritten) return;
    this.#lastState = this.state;
    this.#contextWritten = false;
    this.#subs.emitChange(this.snapshot());
  }

  #dispatch(event: InternalEvent): void {
    if (this.#error !== null || this.state.isFinal) return;
    const normalized: InternalEvent = { ...event, payload: event.payload ?? {} };
    const from = this.state.name;
    const prev = this.#entry;
    this.#entry = { state: this.state, context: this.#context };
    try {
      const transitions = this.#options.transitions;
      const stateTransition = transitions[this.state.name]?.[event.type];
      const anyTransition = transitions["Any"]?.[event.type];
      const result = this.#step(normalized, stateTransition, anyTransition);
      this.#maybeEmitTransition(
        normalized,
        from,
        Boolean(stateTransition || anyTransition),
        result,
      );
      if (result.emitted || this.#queue.length > 0) {
        this.#drainInternal();
      } else if (!stateTransition && !anyTransition) {
        if (this.#internalIds.has(event.type)) {
          this.#enterError(
            "unhandled",
            event,
            new Error(
              `[Actor] internal event "${event.type}" emitted but no handler in state "${this.state.name}"`,
            ),
          );
        }
        // external events with no handler in this state are ignored by design
        // (broadcast fan-out, cross-state sends) — silent, documented pattern.
      }
    } finally {
      this.#entry = prev;
    }
  }

  #step(
    normalized: InternalEvent,
    stateTransition: StepFn<States, ActorContext> | undefined,
    anyTransition: StepFn<States, ActorContext> | undefined,
  ): StepOutcome {
    const stateOutcome = stateTransition
      ? this.#applyStateStep(normalized, stateTransition)
      : { applied: false };
    if (this.#error === null) {
      const anyOutcome = this.#applyAnyStep(normalized, anyTransition, !stateOutcome.applied);
      return {
        emitted: anyOutcome.emitted,
        transitioned: stateOutcome.applied || anyOutcome.transitioned,
        target: stateOutcome.target ?? anyOutcome.target,
      };
    }
    return { emitted: false, transitioned: false };
  }

  #maybeEmitTransition(
    event: InternalEvent,
    from: string,
    handled: boolean,
    outcome: StepOutcome,
  ): void {
    if (this.#error !== null) return;
    if (!handled) return;
    this.#subs.emitTransition({
      event,
      from,
      to: outcome.target ?? this.state.name,
      transitioned: outcome.transitioned,
    });
  }

  #applyStateStep(
    event: InternalEvent,
    transition: StepFn<States, ActorContext>,
  ): { applied: boolean; target?: string } {
    let applied = false;
    let target: string | undefined;
    this.#safe("transition", event, () => {
      const step = transition(event, { context: this.#contextHandle, actor: this as AnyActor });
      if (step.emit) this.#queue.push(...step.emit);
      if (step.state) {
        target = this.#applyTransition(event, step);
        applied = true;
      }
    });
    return { applied, target };
  }

  #applyAnyStep(
    event: InternalEvent,
    transition: StepFn<States, ActorContext> | undefined,
    allowTransition: boolean,
  ): StepOutcome {
    if (transition === undefined) return { emitted: false, transitioned: false };
    let emitted = false;
    let transitioned = false;
    let target: string | undefined;
    this.#safe("transition", event, () => {
      const step = transition(event, { context: this.#contextHandle, actor: this as AnyActor });
      if (step.state && allowTransition) {
        target = this.#applyTransition(event, step);
        transitioned = true;
      }
      if (step.emit) {
        this.#queue.push(...step.emit);
        emitted = true;
      }
    });
    return { emitted, transitioned, target };
  }

  snapshot(): Snapshot<ActorContext> {
    return buildSnapshot(this.state, this.#regions, this.#context, {
      error: this.#error ?? undefined,
      payload: this.#statePayload,
    });
  }

  #applyTransition(
    event: InternalEvent,
    step: TransitionResult<States[number], string>,
  ): string | undefined {
    if (this.#error !== null || !step.state) return undefined;
    const resolved = parseTarget<States[number]>(step);
    if (!resolved) return undefined;
    if (!(resolved.state instanceof StateRef)) {
      this.#enterError("transition", event, new Error("invalid transition target"));
      return undefined;
    }
    this.#effectAbort?.abort();
    this.state = resolved.state;
    const target = this.state.name;
    this.#statePayload = resolved.payload;
    this.#entry = { state: this.state, context: this.#context };
    this.#runEffects(event, resolved.payload);
    if (resolved.state.isFinal && this.#error === null) {
      this.#subs.emitDone();
    }
    return target;
  }

  #runEffects(event: InternalEvent, statePayload: unknown): void {
    if (this.#disposed) return;
    const list = this.#options.effects[this.state.name];
    if (!list) {
      this.#effectAbort = null;
      return;
    }
    const abort = new AbortController();
    this.#effectAbort = abort;
    const lastGood: LastKnownState = this.#entry ?? {
      state: this.state,
      context: this.#context,
    };
    const result = runEffects<ActorContext>({
      effects: { [this.state.name]: list },
      state: this.state,
      statePayload,
      event,
      context: this.#contextHandle,
      emit: (e: InternalEvent) => {
        if (this.#error !== null || abort.signal.aborted) return;
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

  #drainInternal(): void {
    if (this.#draining || this.#disposed) return;
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
        if (this.#internalIds.has(event.type) || this.#inputIds.has(event.type)) {
          this.#dispatch(event);
        } else {
          if (!this.#safe("output", event, () => this.#subs.emitOutput(event))) return false;
        }
        return true;
      });
    } finally {
      this.#draining = false;
      this.#emitChangeIfDirty();
    }
  }

  #statePayload: unknown;

  #pendingEffects: Array<Promise<void>> = [];

  #errorState = new StateRef<"__error", unknown, true>("__error", true);

  #error: ErrorInfo | null = null;

  #entry: LastKnownState | null = null;

  #safe(reason: ErrorReason, event: InternalEvent, fn: () => void): boolean {
    const attempt = Either.from(() => (fn(), true));
    if (attempt[0] === undefined) return true;
    this.#enterError(reason, event, attempt[0]);
    return false;
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
    this.#statePayload = undefined;
    this.#lastState = this.#errorState;
    this.#contextWritten = false;
    this.#subs.emitError(this.#error);
    this.#subs.emitChange(this.snapshot());
    this.#subs.emitDone();
  }

  /** Push an internal event and drain. Unknown types route to output subscribers. */
  inject(event: InternalEvent): void {
    if (this.#disposed) return;
    this.#queue.push(event);
    this.#drainInternal();
  }

  /** Stop for good: abort effect, clear queue and subscribers. Later sends/injects ignored. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#effectAbort?.abort();
    this.#effectAbort = null;
    for (const child of Object.values(this.#regions)) child.dispose();
    this.#regions = {};
    this.#queue.clear();
    this.#subs.clear();
  }

  #disposed = false;
}
