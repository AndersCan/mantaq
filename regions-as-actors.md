# Regions as Actors — Design Discussion

## Problem

Three limitations in the current actor system:

### 1. No parallel states

xstate supports parallel regions where each region is its own state machine.
Currently, "parallel" dimensions are flattened into context fields:

```ts
// Current: brightness is just a field
ctx.brightness = "dim";

// xstate: brightness is its own composable state machine
const machine = createMachine({
  type: "parallel",
  states: {
    brightness: { initial: "normal", states: { dim, normal, bright } },
    color: {
      /* ... */
    },
  },
});
```

No lifecycle, no composition, no per-dimension effects.

### 2. Events don't route to nested regions

When an actor is in `sidebarOpen` and receives `SET_BRIGHTNESS`, it's dropped
silently because `sidebarOpen` has no handler for it. Must duplicate handlers on
every state or manually forward.

### 3. Regions are limited

- Regions can't nest (no `regions` inside `regions`)
- Effects only run on top-level state, not inside regions
- `#regionState` is initialized once in `#initRegionState()` and never mutated

---

## Solution: Regions are Actors

**Core idea:** A region IS a full `Actor` instance. Not lightweight. Not a new
abstraction. Same class, same capabilities.

### Key design decisions

| Decision           | Choice                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Region type        | Full `Actor` instance — own Inputs, Outputs, Context, States, Effects, Transitions |
| Access             | `actor.regions` — NOT on context                                                   |
| Lifecycle          | Always active for now. Reset/recreate on exit later if needed                      |
| Routing            | Explicit — parent transition handler calls `actor.regions.X.send()`                |
| Context on regions | NO — regions don't have context. Context is on the Actor.                          |
| Snapshot           | `actor.snapshot()` recursively includes child Actor snapshots                      |

### Two kinds of transitions

1. **State-dependent** (current behavior): `{ [stateName]: { [eventId]: handler } }`
   Only fires when actor is in that state.

2. **State-independent** (new): `{ [eventId]: handler }` at top level.
   Fires regardless of current state. Used for routing to regions.

Resolution order: state-specific → state-independent → no-op.

---

## Proposed API

### Defining a region (child Actor)

```ts
const setBrightnessRegionEvent = event("SET_BRIGHTNESS_REGION")<{ level: Brightness }>();

const brightnessRegion = new Actor({
  inputs: [setBrightnessRegionEvent],
  states: [dim, normal, bright],
  initial: normal,
  effects: {
    normal: [
      /* effect when entering normal */
    ],
  },
  transitions: {
    dim: { SET_BRIGHTNESS_REGION: (e) => ({ state: normal }) },
    normal: { SET_BRIGHTNESS_REGION: (e) => ({ state: bright }) },
    bright: { SET_BRIGHTNESS_REGION: (e) => ({ state: normal }) },
  },
});
```

### Defining the parent Actor with regions

```ts
const player = new Actor({
  inputs: [openDrawer, closeDrawer, setBrightness, cycleColor],
  internal: [drawerOpenDone, drawerCloseDone],
  states: [root, drawerOpening, drawerClosing],
  regions: { brightness: brightnessRegion, color: colorRegion },
  initial: root,
  effects: {
    drawerOpening: [(input) => withTimeout(300, input, () => ({ id: "DRAWER_OPEN_DONE" }))],
    drawerClosing: [(input) => withTimeout(300, input, () => ({ id: "DRAWER_CLOSE_DONE" }))],
  },
  transitions: {
    // State-independent: fires always, routes to regions
    SET_BRIGHTNESS: (e, ctx) => {
      actor.regions.brightness.send(setBrightnessRegionEvent.create({ level: e.level }));
      return {};
    },
    CYCLE_COLOR: (e, ctx) => {
      actor.regions.color.send(cycleColorRegionEvent.create({}));
      return {};
    },
    // State-dependent: only in these states
    root: {
      OPEN_DRAWER: () => ({ state: drawerOpening }),
      CLOSE_DRAWER: () => ({ state: drawerClosing }),
    },
    drawerOpening: {
      DRAWER_OPEN_DONE: () => ({ state: root }),
    },
    drawerClosing: {
      DRAWER_CLOSE_DONE: () => ({ state: root }),
    },
  },
});
```

### Accessing regions

```ts
actor.regions.brightness.send(event);
actor.regions.brightness.state.name; // "normal"
actor.regions.brightness.context; // own context
actor.regions.brightness.snapshot(); // own snapshot
```

### Snapshot (recursive)

```ts
actor.snapshot();
// {
//   path: ["root"],
//   regions: {
//     brightness: { path: ["normal"], regions: {} },
//     color: { path: ["blue"], regions: {} },
//   },
//   children: { ... }
// }
```

---

## How it solves the three issues

### 1. Parallel states

`brightness` is a full Actor. Own states, effects, context, transitions.
Composable. Has lifecycle.

### 2. Events route to regions

Parent has state-independent `SET_BRIGHTNESS` transition. Fires always.
Handler explicitly delegates to `actor.regions.brightness.send()`.
No implicit routing — parent decides.

### 3. Regions limited

Regions are full Actors. Nested regions = nested Actors.
Effects run on each Actor's own states.
`#regionState` replaced by recursive `actor.snapshot()`.

---

## Implementation plan

### Phase 1: State-independent transitions

**File:** `packages/core/src/actor.ts`

Add support for top-level event-keyed transitions alongside existing
state-keyed transitions.

```ts
transitions: {
  // state-independent (new)
  SET_BRIGHTNESS: (e, ctx) => { ... },
  // state-dependent (existing)
  root: {
    OPEN_DRAWER: () => ({ state: drawerOpening }),
  },
}
```

Changes:

- In `send()`, check `this.options.transitions[event.id]` as fallback when
  `this.options.transitions[this.state.name]?.[event.id]` is undefined
- Type the transitions type to accept both shapes
- Resolution: state-specific first → state-independent → no-op

### Phase 2: Regions as child Actors

**File:** `packages/core/src/actor.ts`

Add `regions` parameter to Actor constructor. Store child Actor instances.

Changes:

- Add `regions?: Record<string, AnyActor>` to constructor options
- Store as `#regions: Map<string, AnyActor>`
- Expose as `get regions()` public accessor
- Wire up child→parent output handlers (like ActorMap does)

### Phase 3: Recursive snapshots

**File:** `packages/core/src/actor.ts`

Update `snapshot()` to recursively call `child.snapshot()` on each region Actor.

Changes:

- In `#snapshot()`, iterate `#regions` and call `child.snapshot()`
- Merge into `regions` field of parent Snapshot
- Remove `#regionState` tracking (regions manage their own state now)

### Phase 4: Region lifecycle

**File:** `packages/core/src/actor.ts`

Handle region creation/destruction on state transitions.

Changes:

- On state transition, regions stay alive (always active for now)
- Future: reset/recreate regions on exit via `final()` states
- Consider: should parent's effects be able to access regions?

### Phase 5: Remove old region code

**File:** `packages/core/src/actor.ts`

Remove `#regionState` map, `#initRegionState()`, and region-state tracking.
Regions are now full Actors managing their own state.

---

## Open questions

### 1. TypeScript typing for `regions`

How to type `actor.regions` so each region is correctly typed?

```ts
// Option A: Generic on Actor
class Actor<..., Regions extends Record<string, AnyActor> = {}> {
  regions: Regions;
}

// Option B: Separate type parameter
class Actor<..., const Regions extends Record<string, AnyActor> = {}> {
  regions: { [K in keyof Regions]: Regions[K] };
}

// Option C: Inferred from constructor
// Regions type is inferred from the `regions` option passed to constructor
```

### 2. Region event typing

When parent calls `actor.regions.brightness.send(event)`, how to type-check
that `event` is valid for the child's Inputs?

```ts
// Child defines its own events
const setBrightnessRegionEvent = event("SET_BRIGHTNESS_REGION")<{ level: Brightness }>();

// Parent sends — should TypeScript verify this event is in child's inputs?
actor.regions.brightness.send(setBrightnessRegionEvent.create({ level: "dim" }));
```

Need to ensure the child Actor's `Inputs` type includes the event being sent.

### 3. Region reset/recreate

When parent transitions out of a state that has regions, what happens?

- **Option A:** Regions stay alive (current plan — always active)
- **Option B:** Regions are reset to initial state on parent state exit
- **Option C:** Regions are destroyed and recreated

For now: always active. But need to decide if parent's `final()` state or
exit transitions should reset regions.

### 4. Snapshot format compatibility

Current snapshot format:

```ts
{ path: ["connected"], regions: { default: { path: ["idle"], regions: {} } } }
```

New snapshot format (with Actor snapshots):

```ts
{ path: ["connected"], regions: { default: { path: ["idle"], regions: {}, done: false, children: {...} } } }
```

Is this backward-compatible? Or breaking change?

### 5. ActorMap relationship

ActorMap currently handles dynamic child actors. Regions are static child actors.
Should these be unified? Or kept separate?

- ActorMap: dynamic children, spawned at runtime
- Regions: static children, defined at construction

For now: keep separate. ActorMap moves to sugar package.

### 6. State-independent transition naming

What should the state-independent transitions key be called?

- `*` (wildcard) — common convention but might confuse with guards
- Top-level event ID — current proposal (`SET_BRIGHTNESS: handler`)
- Explicit `any` key — `{ any: { SET_BRIGHTNESS: handler } }`

Current proposal: top-level event ID (simplest).

---

## DX Findings from Practical Modeling

Modeled a WebSocket reconnection manager (`packages/examples/websocketConnection.actor.test.ts`).
States: disconnected, connecting, connected, reconnecting, permanentlyDisconnected.
Context: retryCount, maxRetries, url, error. Uses `Any` handler for DISCONNECT/FORCE_RECONNECT across states.

### Bug 1: `Any` handler preempts state-specific handlers (`actor.ts:397-399`)

`send()` checks `Any` first. If `Any` returns `{ state }`, it returns immediately. State-specific handler never runs.

```ts
Any: { EV: () => ({ state: cState }) },
a:   { EV: () => ({ state: bState }) },
// When in state "a" and EV arrives → goes to "c", not "b"
```

Consequence: `Any` is NOT a fallback. It is a pre-handler with veto power.

**Fix**: Change resolution order: state-specific first, then `Any` as fallback.

### Bug 2: Queue leak when `Any` emits + state handler returns `{}` (`actor.ts:416-418`)

If `Any` handler pushes to `#internalQueue` and state-specific handler exists but returns `{}` (no state, no emit), the internal queue is never drained.

```ts
Any: { EV: () => ({ emit: [internalEv] }) },
a:   { EV: () => ({}) },
// internalEv pushed to queue but #processInternalQueue never called
```

`#processInternalQueue` only runs in the `if (anyTransition && !stateTransition)` branch (line 416). Since `stateTransition` exists (handler at `a`), drain is skipped. `#applyTransition` on the `{}` result skips both state-change and emit blocks — nothing triggers processing.

### ~~Issue 3: Effect type not exported (`actor.ts:188-203`)~~ **(Resolved)**

`EffectFn` and `EffectInput` types are now exported from `@mantaq/core` barrel. Examples use `EffectFn` directly.

### Issue 4: Inconsistent event send for internal vs input events

Input events typed into `send()` signature — pass event ref directly: `actor.send(disconnect)`.
Internal events NOT in Inputs union — must use `.create()`: `actor.send(connectionFailed.create({error: "msg"}))`.

New users hit TS errors trying `actor.send(connFailed)` (internal EventRef passed as-is).

**Fix**: Add internal events to `send()` overloads or accept `EventRef` for internal events.

### Issue 5: Dead code — `#regionState` map never read (`actor.ts:219, 260-270, 334`)

`#regionState` map populated in `#initRegionState()` at constructor time (line 334).
But `#snapshot()` doesn't read it — always uses `region.states[region.initial]` (line 513).
Never updated after construction. If a state-level region could change, snapshot would always report initial.

The child Actor approach (`#regions`) works correctly because each child stores its own state.

**Fix**: Remove `#regionState`, `#initRegionState()`. State-level region tracking is dead code.

### Issue 6: Two region mechanisms coexist (`actor.ts:511-522`)

Snapshot iterates both:

- State-level `s._regions` (lines 511-518) — static, never updates
- Actor-level `this.#regions` (lines 520-522) — full child Actor snapshots

If both are defined for the same region key, the Actor-level snapshot overwrites the state-level one. This silent override is confusing.

**Fix**: Consolidate — only one region mechanism. All regions should be child Actors.

### Pros of current actor model

- Simple constructor-based API. One class, no builder pattern.
- Virtual Clock makes time-dependent tests deterministic.
- `Any` handler pattern (once bugs fixed) enables cross-cutting concerns.
- Context mutation in transitions is straightforward and TypeScript-friendly.
- Internal event queue + `#processInternalQueue` handles effect→transition chains.
- Regions as child Actors give each region full lifecycle (effects, own context).

### Cons / gaps

- No type-safe region access: `actor.regions.brightness` typed as `AnyActor`, lose all concrete input/state types.
- No parent→child event routing declaration: must manually call `actor.regions.X.send(...)` in handler.
- No child→parent output declaration: child outputs forwarded via `__outputHandler` callback, invisible to parent's type system.
- Nested regions not ergonomic: no sugar for `actor.regions.foo.regions.bar`.
- Snapshot format mixes old `_regions` and new `#regions` — inconsistent.
- `Any` handler naming clashes with real event IDs: if an event is literally named "Any", it breaks.
- No `matches()` pattern for prefix matching: `matches(actor, "disconnected")` works, but `matches(actor, "reconnecting.*")` doesn't exist.
