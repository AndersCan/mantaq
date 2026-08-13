# `@mantaq/core` — Public API Contract

The frozen, hand-curated public surface of `@mantaq/core`. Everything here is
stable; anything not here is not public.

Single entry point: `packages/core/src/index.ts`. A name exported there and
absent here is a guard violation, and vice versa.

## Values

### Actor

The runtime: current state, context, queue, clock, regions, effects. The only thing you construct.

```ts
class Actor<
  const States extends readonly AnyStateRef[],
  const Inputs extends readonly AnyEventRef[],
  const Internal extends readonly AnyEventRef[] = readonly [],
  const Outputs extends readonly AnyEventRef[] = readonly [],
  ActorContext = Record<string, unknown>,
> {
  state: States[number] | ErrorState;
  readonly clock: Clock;
  readonly context: ActorContext;
  readonly regions: Record<string, AnyActor>;
  constructor(options: {
    inputs: Inputs;
    outputs?: Outputs;
    internal?: Internal;
    states: States;
    initial: InitialState<States[number]>;
    context?: ActorContext;
    clock?: Clock;
    internalBudget?: number;
    setup: SetupFn<States, Inputs, Internal, Outputs, ActorContext>;
    regions?: Record<string, AnyActor>;
  });
  send(event: CreatedOf<Inputs[number]>): void;
  snapshot(): Snapshot<ActorContext>;
  on(
    event: "change",
    fn: (snapshot: Snapshot<ActorContext>, prev: Snapshot<ActorContext>) => void,
  ): () => void;
  on(event: "done", fn: () => void): () => void;
  on(
    event: "transition",
    fn: (info: { event: InternalEvent; from: string; to: string }) => void,
  ): () => void;
  recover(target: { state: States[number]; context: ActorContext }): void;
  settled(): Promise<void>;
}
const a = new Actor({
  inputs: [click],
  states: [idle],
  initial: idle,
  setup: (m) => m.on(idle, click, () => ({})),
});
a.send(click.create());
```

### RealClock

Wall-clock `Clock` via platform timers; the default. No public surface beyond `Clock`.

```ts
class RealClock implements Clock {
  // no public members beyond Clock
}
const id = new RealClock().setTimeout(10, () => {});
```

### VirtualClock

Deterministic `Clock` for tests. Time advances only when you say so; drive the machine without sleeping. Delay semantics: `NaN` and `±Infinity` **throw** `RangeError` (programmer error); negative and `0` clamp to `0` for timeouts (fire at the next advance) and to a `1ms` floor for intervals (a `0ms` interval would spin the synchronous advance loop forever). Finite positive values schedule at their real deadline.

```ts
class VirtualClock implements Clock {
  advance(ms: number): void; // fire everything due, then drain
  hasPending(): boolean;
  pendingTimers(): Array<{ id: number; deadline: number; ms: number; eventName?: string }>;
  setDrain(fn: () => void): void;
}
clock.setTimeout(10, () => {});
clock.advance(10); // fires now, synchronously
```

### state

Factory for `StateRef`. Curried: name first, payload type second via generic call. Literal name preserved for the type layer.

```ts
function state<const T extends string>(id: T): <Payload = unknown>() => StateRef<T, Payload, false>;
const idle = state("idle")();
const ready = state("ready")<{ n: number }>();
```

### StateRef

A declared state: literal name, optional payload, finality. The name is the type, so `actor.state` unions correctly.

```ts
class StateRef<T extends string, Payload = unknown, IsFinal extends boolean = false> {
  readonly name: T;
  readonly isFinal: IsFinal;
  final(): StateRef<T, Payload, true>;
  create(payload: Payload): { state: StateRef<T, Payload, IsFinal>; payload: Payload };
  regions(options: Record<string, { initial: string; states: Record<string, AnyStateRef> }>): this;
}
const done = state("done")().final();
const entered = ready.create({ n: 1 });
```

### event

Factory for `EventRef`. Same curry shape as `state`; payload must be `object | void`, payload-less by default.

```ts
function event<const T extends string>(
  type: T,
): <Payload extends object | void = void>() => EventRef<T, Payload>;
const click = event("CLICKED")(); // no payload
const move = event("MOVE")<{ x: number; y: number }>();
```

### EventRef

A declared event: literal type plus optional payload. Creates the event objects `send` accepts and handlers receive.

```ts
class EventRef<const T extends string, Payload extends object | void = void> {
  readonly type: T;
  create(): Payload extends void ? { type: T } : void;
  create(payload: Payload): Payload extends void ? { type: T } : { type: T; payload: Payload };
  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload>;
}
const evt = move.create({ x: 1, y: 2 }); // { type: "MOVE", payload: { x: 1, y: 2 } }
if (move.is(evt)) evt.payload.x; // narrowed
```

### Context

User land. The record you pass to the constructor, mutated freely in handlers. The handle passed to transition handlers and effects as `{ context }`. `get()` returns the live record; `set(value)` is the write signal — calling `set()` emits a `change` event even when the reference is unchanged (so an object mutated in place still signals by being passed to `set`). Context is never deep-compared.

```ts
class Context<T> {
  get(): T;
  set(value: T): void;
}
m.on(idle, tick, (_e, { context }) => {
  const s = context.get();
  s.count += 1;
  context.set(s);
  return {};
});
```

## Types

### Snapshot

Read-only view of actor state: `path` is the state-name chain from the root, `context` is the current context reference, `payload` is the payload the current state was entered with (present only when the transition carried one), `regions` nests child snapshots, `done` appears once a final state is reached. `error` appears once the machine dies into the error state — the actor stops processing and every later `send` is a no-op.

```ts
interface Snapshot<C = unknown> {
  path: string[];
  context: C;
  payload?: unknown;
  regions: Record<string, Snapshot<unknown>>;
  done?: boolean;
  error?: ErrorInfo;
}
```

`done` and `error` are not mutually exclusive: the machine sets `error` when it dies, and the error state is itself terminal, so `done` is also set. `done` alone means the machine completed successfully; `error` means it died. The machine is dead either way — sends are ignored.

### ErrorInfo

What the machine records when it dies into the error state: the thrown value, the state and context at the point of failure (the state being entered when its effect or handler threw — post-step, so error reports reflect what actually ran), the bad event, and why the machine died.

```ts
interface ErrorInfo {
  error: unknown;
  state: AnyStateRef;
  context: unknown;
  event: InternalEvent;
  reason: ErrorReason;
}
const snap = actor.snapshot();
if (snap.error) {
  snap.error.reason; // why the machine died
  snap.error.state.name; // the state at the point of failure
  snap.error.event.type; // the bad event
}
```

### ErrorState

The built-in terminal state the machine enters on any runtime error: a user handler or effect threw; the internal budget was exhausted; an output handler threw; or an internal event was emitted with no handler. It is not a declared state — it is synthesized by the actor. It is final: `snapshot().done` is true and the `done` event fires, so parents and maps can reap it. The machine is dead: remaining queued events are dropped, effects are aborted, and every subsequent `send` is a no-op.

Subscribers are watchers — they only read snapshots, never change the machine — so a subscriber throw is swallowed and never affects the machine or its callers. External events with no handler in the current state are likewise ignored by design (broadcast fan-out, cross-state sends). Every other failure is loud: misconfiguration throws at construction, invalid clock input is clamped platform-style, and runtime user-code errors route to the error state.

```ts
type ErrorState = StateRef<"__error", unknown, true>;
const dead = actor.snapshot().path[0] === "__error";
```

Errors never escape `send()` — they become the error state. Check `snapshot().error` to observe a failure; it is deterministic (same inputs, same trace).

### ErrorReason

The `reason` field of `ErrorInfo`: which boundary the machine died on.

```ts
type ErrorReason =
  "transition" | "effect" | "budget" | "output" | "internal" | "async" | "unhandled";
```

### TransitionResult

What a transition handler returns: an optional target state (with optional payload), and/or events to emit. `emit` may carry a payload; the declared `AllowedEmit` constrains the `type`.

```ts
type TransitionResult<
  AllowedState extends AnyStateRef = AnyStateRef,
  AllowedEmit extends string = string,
> = {
  state?: AllowedState | { state: AllowedState; payload?: unknown };
  payload?: unknown;
  emit?: Array<{ type: AllowedEmit; payload?: unknown }>;
};
```

### ActorOptions

The `Actor` constructor options, as a nameable type.

```ts
type ActorOptions<States, Inputs, Internal, Outputs, ActorContext = Record<string, unknown>> = {
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
};
```

### InitialState

The `initial` option type: either a bare `StateRef` or `{ state, payload }` when the initial state carries a payload.

```ts
type InitialState<S extends AnyStateRef> =
  S extends StateRef<infer _N extends string, infer P>
    ? [unknown] extends [P]
      ? S | { state: S; payload?: P }
      : { state: S; payload: P }
    : never;
```

### recover

`actor.recover({ state, context })` manually restores a dead machine. It is **inherently dangerous** — the caller injects state and context, so the trajectory is no longer deterministic ("same inputs, same trace" no longer holds). It is an explicit escape hatch for app-level recovery, not part of the normal flow; prefer fixing the root cause and recreating the actor.

Recovery does **not** re-run the target state's effects and does not re-arm its timers — the machine resumes event processing only. Send an event (or transition through the state) to re-trigger effects. Recovering into the same state whose effect killed the machine is safe because nothing re-runs.

```ts
actor.recover({ state: idle, context: { retries: 0 } });
```

### on("transition", fn)

Observability hook fired for every **handled** event (matched a state or `onAny` handler), including self-transitions and no-op results, with the real event — internal events from effects included. `from` is the state before dispatch, `to` is the event's own transition target (captured before any cascade runs, so cascaded internal events each report their own `from`/`to` correctly). `transitioned` is true when a state step was applied (including self-transitions, whose effects re-run). Not fired for dropped events. This is the instrumentation primitive behind `@mantaq/test`'s coverage.

```ts
actor.on("transition", ({ event, from, to, transitioned }) => {
  console.log(`${from} --${event.type}--> ${to}${transitioned ? "" : " (no-op)"}`);
});
```

### AnyActor

Structural handle for any actor — regions, `context`, and `options`. `context` is the raw current value; write through the handler `context.set()` instead.

```ts
interface AnyActor<C = Record<string, unknown>> {
  state: AnyStateRef;
  clock: Clock;
  regions: Record<string, AnyActor>;
  context?: C;
  send(event: AnyEventRef | InternalEvent): void;
  snapshot(): Snapshot<C>;
  on(event: "change", fn: (snapshot: Snapshot<C>, prev: Snapshot<C>) => void): () => void;
  on(event: "done", fn: () => void): () => void;
  on(event: "transition", fn: (info: TransitionInfo) => void): () => void;
  recover(target: { state: AnyStateRef; context: C }): void;
  settled(): Promise<void>;
  options?: {
    transitions?: Record<string, Record<string, unknown>>;
    effects?: Record<string, unknown[]>;
    states?: ReadonlyArray<{ name: string; isFinal: boolean }>;
  };
}
```

### Clock

Abstraction over time so the machine is deterministic. `setDrain` is optional; `VirtualClock` uses it to flush the actor queue after `advance`.

```ts
interface Clock {
  setTimeout(
    ms: number,
    cb: () => void,
    options?: { signal?: AbortSignal; eventName?: string },
  ): number;
  clearTimeout(id: number): void;
  setInterval(ms: number, cb: () => void, options?: { signal?: AbortSignal }): number;
  clearInterval(id: number): void;
  now(): number;
  setDrain?(fn: () => void): void;
}
```

### ActorBuilder

The type-safe transition/effect registrar passed to `setup`. Targets validate against declared `States`/`Inputs`/`Internal`/`Outputs` — an undeclared target fails to compile.

```ts
class ActorBuilder<States, Inputs, Internal, Outputs, ActorContext> {
  on<S extends States[number], E extends Inputs[number] | Internal[number]>(
    stateRef: S,
    eventRef: E,
    fn: Handler,
  ): this;
  onAny<E extends Inputs[number] | Internal[number]>(eventRef: E, fn: Handler): this;
  effect<S extends States[number]>(stateRef: S, fn: EffectFn<ActorContext, PayloadOf<S>>): this;
}
// Handler = (event, opts: { context: Context<ActorContext>; actor: AnyActor }) =>
//   { state?: AnyStateRef; payload?: unknown; emit?: Array<{ type: string; payload?: unknown }> }
m.on(idle, click, () => ({ state: active, emit: [pong.create()] }));
m.onAny(click, () => ({ state: idle }));
m.effect(active, ({ context }) => {
  const s = context.get();
  s.ready = true;
  context.set(s);
});
```

### SetupFn

The setup callback type. Receives the builder and wires the machine; invoked by the `Actor` constructor before any event can be sent.

```ts
type SetupFn<States, Inputs, Internal, Outputs, ActorContext> = (
  m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>,
) => void;
```

### BuiltMaps

The built transition/effect registries produced by `ActorBuilder.build()`. Exposed on `actor.options` for tooling and diagnostics.

```ts
interface BuiltMaps<States extends readonly AnyStateRef[], ActorContext> {
  transitions: Record<string, Record<string, TransitionHandler<States, ActorContext>>>;
  effects: Record<string, Array<EffectFn<ActorContext>>>;
}
```

### PayloadOf

Lifts a `StateRef` to its declared payload type — the type `m.effect` infers for `state.payload`.

```ts
type PayloadOf<S extends AnyStateRef> =
  S extends StateRef<infer _Name, infer Payload, infer _IsFinal> ? Payload : never;
```

### EventTypeOf

Lifts an `EventRef` to its declared `type` literal — the constraint on `emit` entries.

```ts
type EventTypeOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, object | void> ? Type : never;
```

### TransitionHandler

The transition handler signature: receives the runtime event and `{ context, actor }`, returns a `TransitionResult`.

```ts
type TransitionHandler<States extends readonly AnyStateRef[], ActorContext> = (
  event: InternalEvent,
  opts: { context: Context<ActorContext>; actor: AnyActor },
) => TransitionResult<States[number], string>;
```

### AnyStateRef

The widened state type, for where any state is acceptable (regions, `AnyActor`).

```ts
type AnyStateRef = StateRef<string, unknown, boolean>;
```

### AnyEventRef

The widened event type.

```ts
type AnyEventRef = EventRef<string, object | void>;
```

### InternalEvent

Runtime event shape: `{ type: string; payload?: unknown }` — the structural contract the queue, effects, and region wiring move. Public despite the prefix; it is the allowlist exception. Handlers always receive a `payload` — a payload-less event is normalized to `payload: {}` at the dispatch boundary, so payload-reading handlers never hit `undefined`.

```ts
type InternalEvent = { type: string; payload?: unknown };
```

### CreatedOfEvent

The payload-carrying event object type: envelope `{ type, payload }`, or just `{ type }` when payload-less.

```ts
type CreatedOfEvent<T extends string, P> = P extends void ? { type: T } : { type: T; payload: P };
```

### EffectInput

Argument to every effect. `signal` ties lifetime to state exit; `emit` sends events back into the machine; `state` is the entered state, `event` caused it. Effects run exactly once per state entry — the initial state runs its effects at construction (`event` is the synthetic `{ type: "__init" }`), and terminal states run theirs on entry.

```ts
interface EffectInput<ActorContext, Payload = unknown> {
  signal: AbortSignal;
  state: { name: string; payload: Payload };
  event: InternalEvent;
  context: Context<ActorContext>;
  emit: (event: InternalEvent) => void;
  clock: Clock;
}
```

`Payload` is inferred from the state's declared payload when the effect is registered with
`m.effect(stateRef, fn)` — `state.payload` is typed, no cast needed. States declared without a
payload generic (`state("idle")()`) keep `payload: unknown`.

### EffectFn

An effect function, run on state entry; the signal aborts on state exit or actor halt. May return a promise for async work — a rejected promise is contained the same way as a synchronous throw and kills the machine.

```ts
type EffectFn<ActorContext, Payload = unknown> = (
  input: EffectInput<ActorContext, Payload>,
) => void | Promise<void>;
m.effect(loading, ({ signal, emit, state }) => {
  state.payload.url; // typed to loading's payload
  const t = setTimeout(() => emit(done.create()), 1000);
  signal.addEventListener("abort", () => clearTimeout(t));
});
```

### NonFinalStateRef

Extracts only non-final members of a states array — the states you may still transition to.

```ts
type NonFinalStateRef<States extends AnyStateRef[]> = Extract<States[number], { isFinal: false }>;
```

### CreatedOf

Lifts an `EventRef` to its created event object. `Actor.send` uses it so only declared-input events are accepted.

```ts
type CreatedOf<E extends AnyEventRef> =
  E extends EventRef<infer Type, infer P> ? CreatedOfEvent<Type, P> : never;
```

## Surface rules

The north star, restated for the public surface. `scripts/vision-guard.mjs`
enforces these mechanically; `typecheck.test.ts` enforces type = behavior. This
document is the oracle for API taste — the product.

- **Small surface.** `index.ts` is capped by an export budget. Every addition
  pays: it must earn its place and update this document.
- **No `Internal*` leaks.** Nothing named `Internal*` may be public except the
  allowlist — currently `InternalEvent`. `__`-prefixed members are internal
  plumbing, not API; treat as absent.
- **One way to do things.** No aliases, no competing APIs. If two exports do the
  same thing, one is a bug. Recipes compose primitives; they add no surface.
- **Type = behavior.** If it typechecks, it runs correct. The names, payloads,
  and literals above are the truth; runtime must match exactly. Forcing the
  compiler quiet is the wrong path — refactor, never cast.
- **Freeze discipline.** Every entry above is a promise. Changing a signature or
  removing a name is breaking; do it deliberately, update this document in the
  same commit, and let the guard prove both in sync.
