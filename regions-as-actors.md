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
