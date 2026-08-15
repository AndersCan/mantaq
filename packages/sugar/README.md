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

e.fetch.create(); // { type: "fetch" }
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
map.spawn("child1", () => createChild()); // warns, aborts the previous child, replaces
```

`ensure()` is idempotent — safe to call repeatedly. `spawn()` always replaces.

### Effect utilities: `withPromise` vs manual handling

Always use `withPromise()` for promise-to-event bridging. It handles abort signals automatically.

```ts
import { withPromise } from "@mantaq/sugar";

// Correct — abort-aware
withPromise(fetchData(), input.signal, input.emit, {
  success: (data) => ({ type: "loaded", payload: data }),
  error: (err) => ({ type: "loadFailed", payload: String(err) }),
});
```

**Anti-pattern:** Manual `.then()/.catch()` without abort handling:

```ts
fetchData()
  .then((data) => {
    input.emit({ type: "loaded", payload: data }); // fires even if actor destroyed
  })
  .catch((err) => {
    input.emit({ type: "loadFailed", payload: String(err) }); // same problem
  });
```

`withPromise` checks `signal.aborted` before each emit. Manual chains fire events into destroyed actors.

### Splitting a big setup with `definePart` and `withParts`

A machine with many states and events grows one long `setup` body. `definePart`
wraps a slice of that setup — its `m.on`, `m.onAny`, and `m.effect` calls — so
it can live in its own file, fully typed against the machine. `withParts`
composes the slices.

```ts
import { definePart, withParts } from "@mantaq/sugar";
import type { checkout } from "./checkout.ts";
import { basicInfo, shippingAddress, submitBasicInfo } from "./checkout.ts";

const basicInfoPart = definePart<typeof checkout>((m) => {
  m.on(basicInfo, submitBasicInfo, (event, opts) => {
    const cur = opts.context.get();
    cur.basicInfo = event.payload;
    opts.context.set(cur);
    return { state: shippingAddress };
  });
});

export const checkoutActor = withParts(checkout, [basicInfoPart /* ... */]);
```

The machine options live in a plain object; `typeof checkout` anchors every
type in the part. Wrong transition targets, event payloads, or context keys
are compile errors — the same as inline. Forget the anchor and `definePart`
errors instead of widening silently. `use(m, part)` registers a part inside a
hand-written setup.

**Anti-pattern:** One monolithic `setup` when the machine outgrows a screen —
every handler in one closure, impossible to split across files.

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

broadcast(map, { type: "ping" });
```

Works with `ActorMap` or any object implementing `{ keys(): string[]; send(key, event): void }`.

### `onOutput(actor, handler)`

Route an actor's emitted outputs to a handler. `regions` auto-wire child
outputs into the parent; ActorMap children do not — this is the public
wrapper for that wiring seam, no internal import needed:

```ts
import { ActorMap, onOutput } from "@mantaq/sugar";

const requests = new ActorMap(
  (id) => {
    const child = createHandler(id);
    onOutput(child, (e) => {
      if (result.is(e)) parent.send(e);
    });
    return child;
  },
  { autoReap: true },
);
```

The `is()` guard narrows the output to the receiver's declared input.

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
e.click.create(); // { type: "click" }
e.click.is(emittedEvent); // boolean
```

### `withPromise(promise, signal, emit, events)`

Bridge a promise into actor events. Emits `success` on resolve, `error` on reject. Respects `AbortSignal` — skips emit if aborted before settlement.

```ts
import { withPromise } from "@mantaq/sugar";

withPromise(fetchData(), input.signal, input.emit, {
  success: (data) => ({ type: "loaded", payload: data }),
  error: (err) => ({ type: "loadFailed", payload: String(err) }),
});
```

### `withTimeout(ms, input, eventFn)`

Schedule a timeout event through the actor's clock. Aborts cleanly if the actor is destroyed before timeout fires.

```ts
import { withTimeout } from "@mantaq/sugar";

withTimeout(5000, input, () => ({ type: "timeout", payload: { reason: "exceeded" } }));
```

### `definePart(machine)`

Wrap a slice of a machine's setup so it can live in its own file. Type against
the machine options object — `definePart<typeof checkout>((m) => {...})`. The
builder inside the part carries the full machine types: states, events,
context, outputs. Without the anchor, `definePart` errors rather than widening
silently.

### `use(m, part)`

Register a part inside a hand-written setup (not the React hook):

```ts
setup: (m) => {
  use(m, basicInfoPart);
  use(m, submittingPart);
};
```

### `withParts(base, parts)`

Build an actor from machine options plus one part or an array of parts. `base`
takes every option `new Actor` takes — clock, regions, budget, initial
included.

```ts
const actor = withParts(checkout, [basicInfoPart, submittingPart, backPart]);
const single = withParts(checkout, basicInfoPart);
```

For the same (state, event), the last registered handler wins. Effects append
instead — every effect on a state runs on entry.

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
