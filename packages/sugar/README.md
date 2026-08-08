# @mantaq/sugar

Convenience helpers for [@mantaq/core](../core) actors. State/event batching, pattern matching, effect utilities, and dynamic child management.

## Install

```bash
npm install @mantaq/sugar
# or
pnpm add @mantaq/sugar
# or
yarn add @mantaq/sugar
```

## Quick Start

```ts
import { states, events, matches, withTimeout } from "@mantaq/sugar";
import { Actor, VirtualClock } from "@mantaq/core";

const s = states("idle", "loading", "success", "error");
const e = events("fetch", "resolve", "fail");

const clock = new VirtualClock();

const machine = new Actor({
  inputs: [e.fetch],
  internal: [e.resolve, e.fail],
  context: {},
  states: [s.idle, s.loading, s.success, s.error],
  initial: s.idle,
  clock,
  setup: (m) => {
    m.on(s.idle, e.fetch, () => ({ state: s.loading }));
    m.effect(s.loading, (input) => withTimeout(2000, input, () => e.resolve.create()));
    m.on(s.loading, e.resolve, () => ({ state: s.success }));
    m.on(s.loading, e.fail, () => ({ state: s.error }));
  },
});

matches(machine, "idle"); // true
machine.send(e.fetch.create());
matches(machine, "loading"); // true
clock.advance(2000);
matches(machine, "success"); // true
```

## Patterns

### Type-safe state groups with `states()`

Use `states()` to create a record of `StateRef`s with full type safety. The returned keys match the input strings exactly.

```ts
import { states } from "@mantaq/sugar";

const s = states("idle", "loading", "success", "error");

s.idle.name; // "idle"
s.success.final(); // StateRef with isFinal = true

const actor = new Actor({
  states: [s.idle, s.loading, s.success, s.error],
  initial: s.idle,
  // ...
});
```

**Anti-pattern:** Creating states manually without `states()` and losing type safety:

```ts
import { state } from "@mantaq/core";

const idle = state("idle")();
const loading = state("loading")();
const success = state("success")();
const error = state("error")();
// No single record — easy to miss one, no autocomplete, no compile check
```

`states()` guarantees all names exist as typed keys. Manual creation requires you to keep references in sync yourself.

### Type-safe event groups with `events()`

Same as `states()` but for events. Creates a typed record with `.create()`, `.is()`, and other `EventRef` methods.

```ts
import { events } from "@mantaq/sugar";

const e = events("fetch", "resolve", "fail");

e.fetch.create(); // { id: "fetch" }
e.resolve.is(emittedEvent); // boolean

const actor = new Actor({
  inputs: [e.fetch],
  internal: [e.resolve],
  // ...
});
```

**Anti-pattern:** Scattering event refs across files without a shared group:

```ts
import { event } from "@mantaq/core";

const fetchEvent = event("fetch")();
const resolveEvent = event("resolve")();
const failEvent = event("fail")();
// No single source of truth — naming drift, typos not caught
```

`events()` creates a single typed object. Any typo in a key is a compile error.

### Pattern matching with `matches()`

`matches()` uses dot-separated paths. The format alternates between state names and region keys: `"state.regionKey.state"`.

```ts
import { matches } from "@mantaq/sugar";

// flat
matches(actor, "idle"); // true if in idle

// hierarchical — state, region key, nested state
matches(actor, "connected.default.active");

// parallel — match any region
matches(actor, "player.playing");
```

**Anti-pattern:** Using wrong path format:

```ts
// WRONG — region key must come after parent state
matches(actor, "active.connected.default");

// WRONG — trailing dot always returns false
matches(actor, "idle.");

// WRONG — empty string returns false
matches(actor, "");
```

Path format: `"parentState.regionKey.childState"`. The region key is the key you passed to the actor's `regions` option, not the nested state's name.

### Using `tag()` for state grouping

`tag()` groups multiple `StateRef`s and tests if a snapshot matches any of them. Useful for UI that needs to branch on state categories.

```ts
import { tag } from "@mantaq/sugar";

const s = states("idle", "loading", "success", "error");
const busy = tag(s.idle, s.loading);
const terminal = tag(s.success, s.error);

// In UI
if (busy.has(snapshot)) {
  showSpinner();
} else if (terminal.has(snapshot)) {
  showResult();
}
```

**Anti-pattern:** Testing individual states manually with `matches()`:

```ts
if (matches(actor, "idle") || matches(actor, "loading")) {
  showSpinner();
}
// Breaks when hierarchy changes, verbose, error-prone
```

`tag()` searches recursively through parallel regions and nested hierarchies — works regardless of depth.

### ActorMap patterns

`ActorMap` manages dynamic children by string key. Always use `ensure()` to avoid duplicate spawns.

```ts
import { ActorMap, isIn } from "@mantaq/sugar";

const map = new ActorMap(parentActor);

// Safe spawn — no-op if key exists
map.ensure("child1", () => createChild());

// Send events
map.send("child1", someEvent);

// Snapshot a child
const snap = map.snapshot("child1");
if (snap && isIn(snap, "active")) {
  // child is active
}

// Kill when done
map.kill("child1");
```

**Anti-pattern:** Using `spawn()` without checking for duplicates:

```ts
map.spawn("child1", () => createChild());
map.spawn("child1", () => createChild()); // overwrites silently — previous child lost
```

`ensure()` is idempotent — safe to call repeatedly. `spawn()` always replaces.

### Effect utilities: `withPromise` vs manual handling

Always use `withPromise()` for promise-to-event bridging. It handles abort signals automatically.

```ts
import { withPromise } from "@mantaq/sugar";

// Correct — abort-aware
withPromise(fetchData(), input.signal, input.emit, {
  success: (data) => ({ id: "loaded", data }),
  error: (err) => ({ id: "loadFailed", error: String(err) }),
});
```

**Anti-pattern:** Manual `.then()/.catch()` without abort handling:

```ts
fetchData()
  .then((data) => {
    input.emit({ id: "loaded", data }); // fires even if actor destroyed
  })
  .catch((err) => {
    input.emit({ id: "loadFailed", error: String(err) }); // same problem
  });
```

`withPromise` checks `isAborted(signal)` before each emit. Manual chains fire events into destroyed actors.

## Helpers

### `matches(actor, pattern)`

Dot-notation state pattern matching against an actor's snapshot. Works with flat, hierarchical, and parallel states.

```ts
import { matches } from "@mantaq/sugar";

// flat
matches(actor, "idle"); // true/false

// hierarchical — region path
matches(actor, "connected.default.active");

// parallel — any region matches
matches(actor, "player.playback.playing");
```

Pattern format: `"state.regionKey.state"` or just `"state"` for flat. Empty string or trailing dots return `false`.

### `ActorMap`

Dynamic child actor registry. Spawns, sends to, kills, and snapshots children by string key. Optionally wires child output to a parent actor.

```ts
import { ActorMap, isIn } from "@mantaq/sugar";

const map = new ActorMap(); // or new ActorMap(parentActor)

map.spawn("child1", () => childActor);
map.spawn("child2", () => otherActor);

map.send("child1", someEvent);
map.kill("child2");
map.keys(); // ["child1"]

const snap = map.snapshot("child1"); // Snapshot | undefined
if (snap && isIn(snap, "active")) {
  // child is active
}
```

**`ensure(key, factory)`** — spawn only if key missing:

```ts
map.ensure("child1", () => childActor); // no-op if exists
```

**Typing children:** `ActorMap` is untyped by design. Access children through your own typed references or use `matches()` / `snapshot()` for type-safe checks.

**Parent wiring:** When constructed with a parent actor, child outputs are automatically forwarded to the parent:

```ts
const map = new ActorMap(parentActor);
map.spawn("child", () => childActor);
// child emits → parent receives
```

### `broadcast(map, event)`

Send an event to every key in an `ActorMap` (or any `SendableMap`):

```ts
import { broadcast } from "@mantaq/sugar";

broadcast(map, { id: "ping" });
```

Works with `ActorMap` or any object implementing `{ keys(): string[]; send(key, event): void }`.

### `tag(...stateRefs)`

Group multiple `StateRef`s and test if a snapshot matches any of them. Useful for UI state grouping.

```ts
import { tag } from "@mantaq/sugar";
import { state } from "@mantaq/core";

const idle = state("idle")();
const loading = state("loading")();
const busy = tag(idle, loading);

busy.has(snapshot); // true if snapshot is idle or loading (any depth)
```

Searches recursively through parallel regions and nested hierarchies.

### `states(...names)`

Batch-create `StateRef`s as a typed record:

```ts
import { states } from "@mantaq/sugar";

const s = states("idle", "loading", "success");
s.idle.name; // "idle"
s.success.final(); // StateRef with isFinal = true
```

### `events(...names)`

Batch-create `EventRef`s as a typed record:

```ts
import { events } from "@mantaq/sugar";

const e = events("click", "submit");
e.click.create(); // { id: "click" }
e.click.is(emittedEvent); // boolean
```

### `withPromise(promise, signal, emit, events)`

Bridge a promise into actor events. Emits `success` on resolve, `error` on reject. Respects `AbortSignal` — skips emit if aborted before settlement.

```ts
import { withPromise } from "@mantaq/sugar";

withPromise(fetchData(), input.signal, input.emit, {
  success: (data) => ({ id: "loaded", data }),
  error: (err) => ({ id: "loadFailed", error: String(err) }),
});
```

### `withTimeout(ms, input, eventFn)`

Schedule a timeout event through the actor's clock. Aborts cleanly if the actor is destroyed before timeout fires.

```ts
import { withTimeout } from "@mantaq/sugar";

withTimeout(5000, input, () => ({ id: "timeout", reason: "exceeded" }));
```

## Migration from Core

Starting with `@mantaq/core`? Here's what sugar adds.

| Core                                    | Sugar                                        | Benefit                                                                   |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `state("idle")()` × N                   | `states("idle", "loading")`                  | Single call. Typed record. No missed names.                               |
| `event("FETCH")()` × N                  | `events("FETCH", "RESOLVE")`                 | Single call. Typed record. Shared source of truth.                        |
| `snapshot().path.includes("active")`    | `matches(actor, "active")`                   | Works on actor directly. Dot-notation for hierarchies: `"idle.region.a"`. |
| Manual `.then()/.catch()` + abort check | `withPromise(promise, signal, emit, events)` | Auto abort-aware. No forgotten `signal.aborted` guard.                    |
| Group states by variable naming         | `tag(stateA, stateB).has(snapshot)`          | Recursive matching. Works through parallel regions.                       |

**Core alone:**

```ts
import { state, event } from "@mantaq/core";

const idle = state("idle")();
const loading = state("loading")();
const success = state("success")();
const failEvent = event("FAIL")();

actor.snapshot().path.includes("idle"); // flat name only
```

**With sugar:**

```ts
import { states, events, matches, tag } from "@mantaq/sugar";

const s = states("idle", "loading", "success");
const e = events("FAIL");

matches(actor, "idle"); // actor, not snapshot
matches(actor, "connected.default.active"); // hierarchical

const busy = tag(s.idle, s.loading);
busy.has(actor.snapshot()); // recursive
```

No migration needed. Sugar wraps core — use both side by side.

## License

MIT
