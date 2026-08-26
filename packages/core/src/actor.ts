import type {
  AnyActor,
  Snapshot,
  SubscriberEventName,
  SubscriberHandler,
} from "./actor-internal.ts";
import type {
  ErrorInfo,
  ErrorReason,
  ErrorState,
  LastKnownState,
  TransitionResult,
} from "./actor-types.ts";
import { ActorBuilder } from "./builder.ts";
import type { EffectEntry, SetupFn } from "./builder.ts";
import type { Clock } from "./clock.ts";
import { Context } from "./context.ts";
import { parseTarget } from "./dispatch.ts";
import { runEffects } from "./effects.ts";
import type { CreatedOfEvent, EventRef, InternalEvent } from "./index.ts";
import { parseContextOption } from "./parse-context-option.ts";
import { InternalQueue } from "./queue.ts";
import { RealClock } from "./real-clock.ts";
import { buildSnapshot, cloneValue } from "./snapshot.ts";
import { StateRef, isStateRef } from "./state.ts";
import type { AnyStateRef } from "./state.ts";
import { Subscribers } from "./subscribers.ts";
import { VirtualClock } from "./virtual-clock.ts";
import { Either } from "@mantaq/utils";

export { RealClock, VirtualClock };
export type { Clock, Snapshot, AnyActor };

type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never;

type AnyEventRef = import("./event.ts").AnyEventRef;

export type InitialState<S extends AnyStateRef> =
  S extends StateRef<infer _N extends string, infer P, infer _I extends boolean>
    ? [unknown] extends [P]
      ? S | { state: S; payload?: P }
      : { state: S; payload: P }
    : never;

function resolveInitial<S extends AnyStateRef>(initial: S | { state: S }): S {
  if ("state" in initial) {
    return initial.state;
  }
  return initial;
}

/**
 * Assert-style precondition. An undeclared initial state is a programmer bug
 * raised before any actor exists that could enter `__error`, so it cannot be
 * returned as a value
 */
function isInitialDeclared(names: ReadonlySet<string>, options: { candidate: AnyStateRef }): true {
  if (!names.has(options.candidate.name)) {
    throw new Error(
      `[Actor] initial state "${options.candidate.name}" not found in declared states [${[...names].join(", ")}]`,
    );
  }
  return true;
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

interface InternalActorOptions<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[],
  Outputs extends readonly AnyEventRef[],
  ActorContext = Record<string, unknown>,
> extends Omit<ActorOptions<States, Inputs, Internal, Outputs, ActorContext>, "setup"> {
  transitions: TransitionDispatch<States, ActorContext>;
  effects: Record<string, Array<EffectEntry<ActorContext>>>;
}

type TransitionDispatch<States extends readonly AnyStateRef[], ActorContext> = Record<
  string,
  Record<string, TransitionStepFn<States, ActorContext> | undefined>
>;

type TransitionStepFn<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  options: { context: Context<ActorContext>; actor: AnyActor<ActorContext> },
) => TransitionResult<States[number], string>;

interface StepOutcome {
  emitted: boolean;
  transitioned: boolean;
  target?: string;
  effects?: string[];
}

export interface Actor<
  States extends readonly AnyStateRef[],
  Inputs extends readonly AnyEventRef[],
  Internal extends readonly AnyEventRef[] = readonly [],
  Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
> extends AnyActor<ActorContext> {
  state: States[number] | ErrorState;
  readonly clock: Clock;
  readonly context: ActorContext;
  readonly regions: Record<string, AnyActor>;
  readonly options: InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext>;
  on<E extends SubscriberEventName>(
    event: E,
    options: { fn: SubscriberHandler<ActorContext, E> },
  ): () => void;
  settled(): Promise<void>;
  pendingEffectCount(): number;
  send(event: CreatedOf<Inputs[number]>): void;
  recover(target: { state: States[number]; context: ActorContext }): void;
  snapshot(): Snapshot<ActorContext>;
  inject(event: InternalEvent): void;
  dispose(): void;
}

export function Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
>(
  options: ActorOptions<States, Inputs, Internal, Outputs, ActorContext>,
): Actor<States, Inputs, Internal, Outputs, ActorContext> {
  const builder = ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>();
  options.setup(builder);
  const built = builder.build();

  const actorOptions: InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext> = {
    ...options,
    transitions: built.transitions,
    effects: built.effects,
  };

  const internalIds = new Set((options.internal ?? []).map((entry) => entry.type));
  const inputIds = new Set(options.inputs.map((entry) => entry.type));
  const internalBudget = options.internalBudget ?? 10_000;
  const clock: Clock = options.clock ?? RealClock();
  clock.setDrain?.(drain);

  let currentState: States[number] | ErrorState;
  let currentPayload: unknown;
  let contextValue = parseContextOption<ActorContext>(options.context);
  /**
   * Last context object handed to subscribers. The actor never exposes the
   * live `contextValue`. It clones it and caches the copy so that unchanged
   * snapshots keep a stable identity (subscribers rely on stable identity to
   * detect context changes) while a mutated snapshot cannot reach live state
   * (issue #226)
   */
  let deliveredContext: ActorContext | undefined;
  /** Set when `contextValue` has changed since the last delivered snapshot. */
  let contextDirty = true;
  let lastState: AnyStateRef;
  let regionActors: Record<string, AnyActor> = {};
  let queue = InternalQueue();
  const subs = Subscribers<ActorContext>();
  let effectAbort: AbortController | undefined;
  let draining = false;
  let pendingEffects: Array<Promise<void>> = [];
  let errorInfo: ErrorInfo | undefined;
  let lastEntry: LastKnownState | undefined;
  let disposed = false;
  let contextWritten = false;

  const errorState: ErrorState = StateRef<"__error", unknown, true>("__error", { isFinal: true });

  const contextHandle = Context<ActorContext>({
    get: () => contextValue,
    set: (value: ActorContext) => {
      contextValue = value;
      contextWritten = true;
      contextDirty = true;
    },
  });

  const initState = resolveInitial(options.initial);
  isInitialDeclared(new Set(options.states.map((entry) => entry.name)), { candidate: initState });
  currentState = initState;
  const initialInput = options.initial;
  currentPayload =
    !isStateRef(initialInput) && "payload" in initialInput ? initialInput.payload : undefined;
  lastState = initState;

  if (options.regions) {
    for (const [key, child] of Object.entries(options.regions)) {
      regionActors[key] = child;
      child.on("output", {
        fn: (event) => {
          queue.push(event);
          drain();
        },
      });
    }
  }

  const publicActor: Actor<States, Inputs, Internal, Outputs, ActorContext> = {
    get state(): States[number] | ErrorState {
      return currentState;
    },
    clock,
    get regions(): Record<string, AnyActor> {
      return regionActors;
    },
    get context(): ActorContext {
      return contextValue;
    },
    get options(): InternalActorOptions<States, Inputs, Internal, Outputs, ActorContext> {
      return actorOptions;
    },

    on<E extends SubscriberEventName>(
      event: E,
      subscriber: { fn: SubscriberHandler<ActorContext, E> },
    ): () => void {
      const cases: {
        [K in SubscriberEventName]: (fn: SubscriberHandler<ActorContext, K>) => () => void;
      } = {
        change: (fn) => subs.addChange(fn),
        done: (fn) => subs.addDone(fn),
        transition: (fn) => subs.addTransition(fn),
        error: (fn) => subs.addError(fn),
        output: (fn) => subs.addOutput(fn),
      };
      return cases[event](subscriber.fn);
    },

    settled(): Promise<void> {
      return settled();
    },

    pendingEffectCount(): number {
      return pendingEffects.length;
    },

    send(event: CreatedOf<Inputs[number]>): void {
      if (disposed) return;
      dispatch(event);
      emitChangeIfDirty();
    },

    recover,

    snapshot(): Snapshot<ActorContext> {
      return snapshot();
    },

    inject(event: InternalEvent): void {
      inject(event);
    },

    dispose(): void {
      dispose();
    },
  };

  // Enter the initial state like any other entry: run effects, then seed.
  runEffectList({ type: "__init" }, { payloadForState: currentPayload });
  subs.seed(snapshot());

  function emitChangeIfDirty(): void {
    if (currentState === lastState && !contextWritten) return;
    lastState = currentState;
    contextWritten = false;
    subs.emitChange(snapshot());
  }

  /**
   * Restore a live state after `__error`. DANGER: caller supplies state and
   * context, breaking determinism. Effects not re-run. Processing resumes on
   * next event
   */
  function recover(target: { state: States[number]; context: ActorContext }): void {
    if (errorInfo === undefined || disposed) return;
    effectAbort?.abort();
    effectAbort = undefined;
    queue.clear();
    queue = InternalQueue();
    errorInfo = undefined;
    currentState = target.state;
    currentPayload = undefined;
    contextValue = target.context;
    lastState = target.state;
    contextWritten = false;
    contextDirty = true;
    deliveredContext = undefined;
    lastEntry = undefined;
    pendingEffects = [];
    subs.emitChange(snapshot());
  }

  function dispatch(event: InternalEvent): void {
    if (errorInfo !== undefined || currentState.isFinal) return;
    const normalized: InternalEvent = { ...event, payload: event.payload ?? {} };
    const from = currentState.name;
    const previous = lastEntry;
    lastEntry = { state: currentState, context: contextValue };
    try {
      const transitions = actorOptions.transitions;
      const stateTransition = transitions[currentState.name]?.[event.type];
      const anyTransition = transitions["Any"]?.[event.type];
      const outcome = step(normalized, { stateTransition, anyTransition });
      maybeEmitTransition(normalized, {
        from,
        handled: Boolean(stateTransition || anyTransition),
        outcome,
      });
      if (outcome.emitted || queue.length > 0) {
        drain();
      } else if (!stateTransition && !anyTransition) {
        if (internalIds.has(event.type)) {
          enterError("unhandled", {
            event,
            error: new Error(
              `[Actor] internal event "${event.type}" emitted but no handler in state "${currentState.name}"`,
            ),
          });
        }
        /**
         * external events with no handler in this state are ignored by design
         * (broadcast fan-out, cross-state sends). Silent, documented pattern.
         */
      }
    } finally {
      lastEntry = previous;
    }
  }

  function step(
    normalized: InternalEvent,
    handlers: {
      stateTransition: TransitionStepFn<States, ActorContext> | undefined;
      anyTransition: TransitionStepFn<States, ActorContext> | undefined;
    },
  ): StepOutcome {
    const stateOutcome = handlers.stateTransition
      ? applyStateStep(normalized, { transition: handlers.stateTransition })
      : { applied: false, target: undefined, effects: undefined };
    if (errorInfo === undefined) {
      const anyOutcome = applyAnyStep(normalized, {
        transition: handlers.anyTransition,
        allowTransition: !stateOutcome.applied,
      });
      return {
        emitted: anyOutcome.emitted,
        transitioned: stateOutcome.applied || anyOutcome.transitioned,
        target: stateOutcome.target ?? anyOutcome.target,
        effects: stateOutcome.effects ?? anyOutcome.effects,
      };
    }
    return { emitted: false, transitioned: false };
  }

  function maybeEmitTransition(
    event: InternalEvent,
    info: { from: string; handled: boolean; outcome: StepOutcome },
  ): void {
    if (errorInfo !== undefined) return;
    if (!info.handled) return;
    subs.emitTransition({
      event,
      from: info.from,
      to: info.outcome.target ?? currentState.name,
      transitioned: info.outcome.transitioned,
      effects: info.outcome.effects ?? [],
    });
  }

  function applyStateStep(
    event: InternalEvent,
    handler: { transition: TransitionStepFn<States, ActorContext> },
  ): { applied: boolean; target?: string; effects?: string[] } {
    let applied = false;
    let target: string | undefined;
    let effects: string[] | undefined;
    guardFailure("transition", {
      event,
      operation: () => {
        const next = handler.transition(event, {
          context: contextHandle,
          actor: selfReference(),
        });
        if (next.emit) queue.push(...next.emit);
        if (next.state) {
          const entered = applyTransition(event, { step: next });
          target = entered.target;
          effects = entered.effects;
          applied = true;
        }
      },
    });
    return { applied, target, effects };
  }

  function applyAnyStep(
    event: InternalEvent,
    handler: {
      transition: TransitionStepFn<States, ActorContext> | undefined;
      allowTransition: boolean;
    },
  ): StepOutcome {
    if (handler.transition === undefined) return { emitted: false, transitioned: false };
    const transition = handler.transition;
    let emitted = false;
    let transitioned = false;
    let target: string | undefined;
    let effects: string[] | undefined;
    guardFailure("transition", {
      event,
      operation: () => {
        const next = transition(event, {
          context: contextHandle,
          actor: selfReference(),
        });
        if (next.state && handler.allowTransition) {
          const entered = applyTransition(event, { step: next });
          target = entered.target;
          effects = entered.effects;
          transitioned = true;
        }
        if (next.emit) {
          queue.push(...next.emit);
          emitted = true;
        }
      },
    });
    return { emitted, transitioned, target, effects };
  }

  function snapshot(): Snapshot<ActorContext> {
    if (deliveredContext === undefined || contextDirty) {
      deliveredContext = cloneValue(contextValue);
      contextDirty = false;
    }
    return buildSnapshot({
      stateRef: currentState,
      regions: regionActors,
      context: deliveredContext,
      error: errorInfo,
      payload: currentPayload,
    });
  }

  function applyTransition(
    event: InternalEvent,
    next: { step: TransitionResult<States[number], string> },
  ): { target?: string; effects?: string[] } {
    if (errorInfo !== undefined || !next.step.state) return {};
    const resolved = parseTarget<States[number]>(next.step);
    if (!resolved) return {};
    if (!isStateRef(resolved.state)) {
      enterError("transition", { event, error: new Error("invalid transition target") });
      return {};
    }
    effectAbort?.abort();
    currentState = resolved.state;
    const target = currentState.name;
    currentPayload = resolved.payload;
    lastEntry = { state: currentState, context: contextValue };
    const ran = runEffectList(event, { payloadForState: resolved.payload });
    if (resolved.state.isFinal && errorInfo === undefined) {
      subs.emitDone();
    }
    return { target, effects: ran };
  }

  function runEffectList(event: InternalEvent, options: { payloadForState: unknown }): string[] {
    if (disposed) return [];
    const list = actorOptions.effects[currentState.name];
    if (!list) {
      effectAbort = undefined;
      return [];
    }
    const abort = new AbortController();
    effectAbort = abort;
    const lastGood: LastKnownState = lastEntry ?? {
      state: currentState,
      context: contextValue,
    };
    const result = runEffects<ActorContext>({
      effects: { [currentState.name]: list },
      state: currentState,
      statePayload: options.payloadForState,
      event,
      context: contextHandle,
      emit: (emitted: InternalEvent) => {
        if (errorInfo !== undefined || abort.signal.aborted) return;
        queue.push(emitted);
        drain();
      },
      clock,
      abort,
      lastGood,
      onError: (failure: unknown) => enterError("effect", { event, error: failure }),
    });
    for (const promise of result.pending) {
      pendingEffects.push(promise);
      void promise
        .finally(() => {
          const position = pendingEffects.indexOf(promise);
          if (position !== -1) pendingEffects.splice(position, 1);
        })
        .catch(() => {});
    }
    return result.ran;
  }

  function drain(): void {
    if (draining || disposed) return;
    draining = true;
    try {
      let count = 0;
      queue.processCancellable((event) => {
        if (errorInfo !== undefined) return false;
        if (count >= internalBudget) {
          enterError("budget", { event, error: new Error("internal event budget exceeded") });
          return false;
        }
        count++;
        if (internalIds.has(event.type) || inputIds.has(event.type)) {
          dispatch(event);
        } else {
          if (!guardFailure("output", { event, operation: () => subs.emitOutput(event) })) {
            return false;
          }
        }
        return true;
      });
    } finally {
      draining = false;
      emitChangeIfDirty();
    }
  }

  /**
   * Runs `fn` and routes a thrown failure into the error state. Handlers are
   * user code of unbounded shape, so a failure here is an expected outcome and
   * arrives as the Either-style left value captured by `Either.from`
   */
  function guardFailure(
    reason: ErrorReason,
    options: { event: InternalEvent; operation: () => void },
  ): boolean {
    const attempt = Either.from(() => (options.operation(), true));
    if (attempt[0] === undefined) return true;
    enterError(reason, { event: options.event, error: attempt[0] });
    return false;
  }

  function enterError(
    reason: ErrorReason,
    failure: { event: InternalEvent; error: unknown; lastGood?: LastKnownState },
  ): void {
    if (errorInfo !== undefined) return;
    const known = failure.lastGood ??
      lastEntry ?? {
        state: currentState,
        context: contextValue,
      };
    errorInfo = {
      error: failure.error,
      state: known.state,
      context: known.context,
      event: failure.event,
      reason,
    };
    effectAbort?.abort();
    currentState = errorState;
    currentPayload = undefined;
    lastState = errorState;
    contextWritten = false;
    subs.emitError(errorInfo);
    subs.emitChange(snapshot());
    subs.emitDone();
  }

  function inject(event: InternalEvent): void {
    if (disposed) return;
    queue.push(event);
    drain();
  }

  /** Stop for good: abort effect, clear queue and subscribers. Later sends ignored. */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    effectAbort?.abort();
    effectAbort = undefined;
    for (const child of Object.values(regionActors)) child.dispose();
    regionActors = {};
    queue.clear();
    subs.clear();
    pendingEffects = [];
  }

  function settled(): Promise<void> {
    return queue.settled().then(() => {
      if (pendingEffects.length === 0) return;
      return Promise.all(pendingEffects).then(() => settled());
    });
  }

  /**
   * Handlers receive the live actor through their options. The public surface
   * structurally satisfies the runtime contract, so no wrapper is needed.
   */
  function selfReference(): AnyActor<ActorContext> {
    return publicActor;
  }

  return publicActor;
}
