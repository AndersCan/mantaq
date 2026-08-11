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
  state: States[number];
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

Deterministic `Clock` for tests. Time advances only when you say so; drive the machine without sleeping.

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
  create(payload: Payload): CreatedOfEvent<T, Payload>;
  is(anyEvent: unknown): anyEvent is CreatedOfEvent<T, Payload>;
}
const evt = move.create({ x: 1, y: 2 }); // { type: "MOVE", payload: { x: 1, y: 2 } }
if (move.is(evt)) evt.payload.x; // narrowed
```

### Context

The handle passed to transition handlers and effects as `{ context }`. `get()` reads the current context value; `set(value)` replaces it wholesale and is the write signal — calling `set()` emits a `change` event even when the reference is unchanged (so a class instance mutated in place still signals by being passed to `set`). Context is compared by reference identity, never deep-compared. Earlier `get()` bindings go stale after a `set`.

```ts
class Context<T> {
  get(): T;
  set(value: T): void;
}
m.on(idle, tick, (_e, { context }) => {
  const s = context.get();
  context.set({ ...s, count: s.count + 1 });
  return {};
});
```

## Types

### Snapshot

Read-only view of actor state: `path` is the state-name chain from the root, `context` is the current context reference, `regions` nests child snapshots, `done` appears once a final state is reached.

```ts
interface Snapshot<C = unknown> {
  path: string[];
  context: C;
  regions: Record<string, Snapshot<unknown>>;
  done?: boolean;
}
```

### AnyActor

Structural handle for any actor — regions and `options.regions`. `__`-prefixed members are internal plumbing (a refactor is removing them), **not** public contract; treat them as absent.

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
  settled(): Promise<void>;
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
//   { state?: AnyStateRef; payload?: unknown; emit?: Array<{ type: string }> }
m.on(idle, click, () => ({ state: active, emit: [pong.create()] }));
m.onAny(click, () => ({ state: idle }));
m.effect(active, ({ context }) => {
  const s = context.get();
  context.set({ ...s, ready: true });
});
```

### SetupFn

The setup callback type. Receives the builder and wires the machine; invoked by the `Actor` constructor before any event can be sent.

```ts
type SetupFn<States, Inputs, Internal, Outputs, ActorContext> = (
  m: ActorBuilder<States, Inputs, Internal, Outputs, ActorContext>,
) => void;
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

Runtime event shape: `{ type: string; payload?: unknown }` — the structural contract the queue, effects, and region wiring move. Public despite the prefix; it is the allowlist exception.

```ts
type InternalEvent = { type: string; payload?: unknown };
```

### CreatedOfEvent

The payload-carrying event object type: envelope `{ type, payload }`, or just `{ type }` when payload-less.

```ts
type CreatedOfEvent<T extends string, P> = P extends void ? { type: T } : { type: T; payload: P };
```

### EffectInput

Argument to every effect. `signal` ties lifetime to state exit; `emit` sends events back into the machine; `state` is the entered state, `event` caused it.

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

An effect function, run on state entry; the signal aborts on state exit or actor halt.

```ts
type EffectFn<ActorContext, Payload = unknown> = (
  input: EffectInput<ActorContext, Payload>,
) => void;
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
  allowlist — currently `InternalEvent`. `__`-prefixed members (e.g.
  `AnyActor.__children`) are internal plumbing, not API; treat as absent.
- **One way to do things.** No aliases, no competing APIs. If two exports do the
  same thing, one is a bug. Recipes compose primitives; they add no surface.
- **Type = behavior.** If it typechecks, it runs correct. The names, payloads,
  and literals above are the truth; runtime must match exactly. Forcing the
  compiler quiet is the wrong path — refactor, never cast.
- **Freeze discipline.** Every entry above is a promise. Changing a signature or
  removing a name is breaking; do it deliberately, update this document in the
  same commit, and let the guard prove both in sync.
