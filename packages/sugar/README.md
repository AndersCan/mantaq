# @mantaq/sugar

Convenience helpers for [@mantaq/core](https://www.npmjs.com/package/@mantaq/core) actors. State/event batching, pattern matching, effect utilities, and dynamic child management.

## Install

```bash
npm install @mantaq/core @mantaq/sugar
```

## Quick Start

```ts
import { states, events, matches, withTimeout } from "@mantaq/sugar";
import { Actor, VirtualClock } from "@mantaq/core";

const s = states("idle", "loading", "success", "error");
const e = events("fetch", "resolve", "fail");

const clock = VirtualClock();

const machine = Actor({
  inputs: [e.fetch],
  internal: [e.resolve, e.fail],
  states: [s.idle, s.loading, s.success, s.error],
  initial: s.idle,
  clock,
  setup: (m) => {
    m.on(s.idle, { event: e.fetch, to: [s.loading], handler: () => ({ state: s.loading }) });
    m.effect(s.loading, {
      name: "startFetchTimeout",
      sends: [e.resolve],
      fn: (input) => withTimeout(2000, { input, event: () => e.resolve.create() }),
    });
    m.on(s.loading, { event: e.resolve, to: [s.success], handler: () => ({ state: s.success }) });
    m.on(s.loading, { event: e.fail, to: [s.error], handler: () => ({ state: s.error }) });
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

`states()` returns a record of `StateRef`s. The keys match the input strings exactly; `{ name, final: true }` makes a final state.

```ts
import { states } from "@mantaq/sugar";

const s = states("idle", "loading", { name: "success", final: true });

s.idle.name; // "idle"
s.success.isFinal; // true
```

Creating states one by one with `state("idle")()` works too, but there is no single record: easy to miss one, and no autocomplete over the group.

### Type-safe event groups with `events()`

Same as `states()` but for payload-less events. Each entry is an `EventRef` with `.create()` and `.is()`.

```ts
import { events } from "@mantaq/sugar";

const e = events("fetch", "resolve", "fail");

const sent = e.fetch.create(); // { type: "fetch" }
e.resolve.is(sent); // false
```

Events that carry a payload still use `event("ID")<Payload>()` from core.

### Pattern matching with `matches()`

`matches()` uses dot-separated paths. The format alternates between state names and region keys: `"state.regionKey.state"`.

```ts
import { Actor, state, event } from "@mantaq/core";
import { matches } from "@mantaq/sugar";

const off = state("off")();
const on = state("on")();
const playing = state("playing")();
const flip = event("FLIP")();

const player = Actor({
  inputs: [],
  states: [playing],
  initial: playing,
  setup: () => {},
});

const actor = Actor({
  inputs: [flip],
  states: [off, on],
  initial: on,
  regions: { player },
  setup: (m) => {
    m.on(on, { event: flip, to: [off], handler: () => ({ state: off }) });
  },
});

matches(actor, "on"); // true: flat
matches(actor, "on.player.playing"); // true: state, region key, nested state

matches(actor, "player.playing.on"); // false: region key must follow its parent state
matches(actor, "on."); // false: trailing dot
matches(actor, ""); // false: empty string
```

The region key is the key you passed to the actor's `regions` option, not the nested state's name.

### Using `tag()` for state grouping

`tag()` groups `StateRef`s and tests if a snapshot is in any of them, at any depth. Useful for UI that branches on state categories.

```ts
import { states, tag } from "@mantaq/sugar";
import type { Snapshot } from "@mantaq/core";

declare const snapshot: Snapshot;
declare function showSpinner(): void;
declare function showResult(): void;

const s = states("idle", "loading", "success", "error");
const busy = tag(s.idle, s.loading);
const terminal = tag(s.success, s.error);

if (busy.has(snapshot)) {
  showSpinner();
} else if (terminal.has(snapshot)) {
  showResult();
}
```

Chaining `matches(actor, "idle") || matches(actor, "loading")` breaks when the hierarchy changes. `tag()` searches parallel regions and nested hierarchies recursively.

### ActorMap: dynamic children by key

`createActorMap(factory)` manages children keyed by string. The factory builds the child for a key. `ensure()` spawns only when the key is missing; `spawn()` always replaces (the previous child is disposed).

```ts
import { Actor, state, event } from "@mantaq/core";
import { createActorMap, isIn } from "@mantaq/sugar";

const idle = state("idle")();
const active = state("active")();
const activate = event("ACTIVATE")();

function createChild(id: string) {
  return Actor({
    inputs: [activate],
    states: [idle, active],
    initial: idle,
    context: { id },
    setup: (m) => {
      m.on(idle, { event: activate, to: [active], handler: () => ({ state: active }) });
    },
  });
}

const map = createActorMap((id) => createChild(id), { autoReap: true });

map.ensure("child1"); // spawns
map.ensure("child1"); // no-op: already there
map.send("child1", activate.create());

const snap = map.snapshot("child1"); // Snapshot | undefined
if (snap && isIn(snap, "active")) {
  // child is active
}

map.keys(); // ["child1"]
map.kill("child1");
```

`autoReap: true` removes a child once it reaches a final state.

**Typing children:** `ActorMap` is untyped by design. Check children with `snapshot()` + `isIn` / `matches`, or keep your own typed references.

### Effect utilities: `withPromise` vs manual handling

Use `withPromise()` to bridge a promise into events. It checks `signal.aborted` before each emit, so a promise that settles after the state exits emits nothing.

```ts
import { Actor, state, event } from "@mantaq/core";
import { withPromise } from "@mantaq/sugar";

declare function fetchData(): Promise<string[]>;

const loading = state("loading")();
const loaded = state("loaded")();
const failed = state("failed")();
const loadedEvent = event("loaded")<{ items: string[] }>();
const failedEvent = event("loadFailed")<{ message: string }>();

Actor({
  inputs: [],
  internal: [loadedEvent, failedEvent],
  states: [loading, loaded, failed],
  initial: loading,
  setup: (m) => {
    m.effect(loading, {
      name: "fetchData",
      sends: [loadedEvent, failedEvent],
      fn: (input) =>
        withPromise({
          promise: fetchData(),
          signal: input.signal,
          emit: input.emit,
          events: {
            success: (items) => loadedEvent.create({ items }),
            error: (err) => failedEvent.create({ message: String(err) }),
          },
        }),
    });
    m.on(loading, { event: loadedEvent, to: [loaded], handler: () => ({ state: loaded }) });
    m.on(loading, { event: failedEvent, to: [failed], handler: () => ({ state: failed }) });
  },
});
```

**Anti-pattern.** A manual `fetchData().then((data) => input.emit(...))` fires even after the state exits or the actor is disposed, unless you check `input.signal.aborted` yourself.

## Helpers

### `matches(actor, pattern)`

Dot-notation state pattern matching against an actor's snapshot. Works with flat, hierarchical, and parallel states. Pattern format: `"state.regionKey.state"` or just `"state"` for flat. Empty string or trailing dots return `false`. See [Pattern matching](#pattern-matching-with-matches).

### `isIn(snapshot, name)` / `activeLeaves(snapshot)`

`isIn` is true when the snapshot, or any region in it, is in the named state. `activeLeaves` lists every active leaf as a dotted path.

```ts
import { isIn, activeLeaves } from "@mantaq/sugar";
import type { Snapshot } from "@mantaq/core";

declare const snapshot: Snapshot;

isIn(snapshot, "playing");
activeLeaves(snapshot); // e.g. ["on.player.playing"]
```

### `createActorMap(factory, { autoReap? })`

Dynamic child actor registry: `spawn`, `ensure`, `send`, `kill`, `has`, `keys`, `snapshot`, `size`, `dispose`. See [ActorMap](#actormap-dynamic-children-by-key).

### `broadcast(map, event)`

Send an event to every key in an `ActorMap` (or any `SendableMap`):

```ts
import { broadcast } from "@mantaq/sugar";
import type { ActorMap } from "@mantaq/sugar";

declare const map: ActorMap;

broadcast(map, { type: "ping" });
```

Works with any object implementing `{ keys(): string[]; send(key, event): void }`.

### `onOutput(actor, handler)`

Route an actor's emitted outputs to a handler. `regions` auto-wire child
outputs into the parent; ActorMap children do not. `onOutput` is the public
wrapper for that wiring:

```ts
import { Actor, state, event } from "@mantaq/core";
import { createActorMap, onOutput } from "@mantaq/sugar";

const result = event("RESULT")<{ id: string }>();
const finish = event("FINISH")();
const working = state("working")();
const done = state("done")().final();
const collecting = state("collecting")();

const parent = Actor({
  inputs: [result],
  states: [collecting],
  initial: collecting,
  setup: (m) => {
    m.on(collecting, { event: result, handler: () => ({}) });
  },
});

function createHandler(id: string) {
  return Actor({
    inputs: [finish],
    outputs: [result],
    states: [working, done],
    initial: working,
    setup: (m) => {
      m.on(working, {
        event: finish,
        to: [done],
        handler: () => ({ state: done, emit: [result.create({ id })] }),
      });
    },
  });
}

const requests = createActorMap(
  (id) => {
    const child = createHandler(id);
    onOutput(child, (e) => {
      if (result.is(e)) parent.send(e);
    });
    return child;
  },
  { autoReap: true },
);

requests.spawn("r1");
requests.send("r1", finish.create());
```

The `is()` guard narrows the output to the receiver's declared input.

### `tag(...stateRefs)`

Group `StateRef`s; `tag(...).has(snapshot)` is true if the snapshot is in any of them, at any depth. See [tag()](#using-tag-for-state-grouping).

### `states(...names)` / `events(...names)`

Batch-create `StateRef`s / payload-less `EventRef`s as a typed record. See [states()](#type-safe-state-groups-with-states) and [events()](#type-safe-event-groups-with-events).

### `withPromise({ promise, signal, emit, events })`

Bridge a promise into actor events. Emits `events.success(data)` on resolve, `events.error(err)` on reject. Skips the emit if `signal` aborted before settlement. Returns a promise, so returning it from an effect lets `actor.settled()` wait for it.

#### Errors as values

When a port returns `Promise<Either<PortError, Loaded>>`, map the result with `Either.match` inside `success`. No new helper is needed, and both branches stay typed without a cast:

```ts
import { Actor, state, event } from "@mantaq/core";
import type { CreatedOf } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { withPromise } from "@mantaq/sugar";

type PortError = { code: string };
type Loaded = { items: string[] };
declare const port: { load(): Promise<Either<PortError, Loaded>> };

const loading = state("loading")();
const ready = state("ready")();
const loaded = event("loaded")<Loaded>();
const failed = event("failed")<PortError>();
const loadRejected = event("loadRejected")<{ message: string }>();
type LoadEvent = CreatedOf<typeof loaded> | CreatedOf<typeof failed>;

Actor({
  inputs: [],
  internal: [loaded, failed, loadRejected],
  states: [loading, ready],
  initial: loading,
  setup: (m) => {
    m.effect(loading, {
      name: "load",
      sends: [loaded, failed, loadRejected],
      fn: (input) =>
        withPromise({
          promise: port.load(),
          signal: input.signal,
          emit: input.emit,
          events: {
            success: (result) =>
              Either.match(result, {
                onLeft: (e): LoadEvent => failed.create(e), // e: PortError
                onRight: (v): LoadEvent => loaded.create(v), // v: Loaded
              }),
            error: (err) => loadRejected.create({ message: String(err) }),
          },
        }),
    });
    m.on(loading, { event: loaded, to: [ready], handler: () => ({ state: ready }) });
    m.on(loading, { event: failed, handler: () => ({}) });
    m.on(loading, { event: loadRejected, handler: () => ({}) });
  },
});
```

`LoadEvent` is the union of the two event shapes; annotating both handlers with it lets `Either.match` infer one result type. A rejected promise still goes through `error`, and an effect aborted before the promise settles emits nothing.

### `withTimeout(ms, { input, event })`

Schedule a timeout event through the effect's clock. Cleared when the state exits.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

const waiting = state("waiting")();
const expired = state("expired")();
const timeout = event("timeout")<{ reason: string }>();

Actor({
  inputs: [],
  internal: [timeout],
  states: [waiting, expired],
  initial: waiting,
  clock: VirtualClock(),
  setup: (m) => {
    m.effect(waiting, {
      name: "expireAfter5s",
      sends: [timeout],
      fn: (input) =>
        withTimeout(5000, { input, event: () => timeout.create({ reason: "exceeded" }) }),
    });
    m.on(waiting, { event: timeout, to: [expired], handler: () => ({ state: expired }) });
  },
});
```

## Migration from Core

Starting with `@mantaq/core`? Here's what sugar adds.

| Core                                    | Sugar                                            | Benefit                                                                   |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `state("idle")()` × N                   | `states("idle", "loading")`                      | Single call. Typed record. No missed names.                               |
| `event("FETCH")()` × N                  | `events("FETCH", "RESOLVE")`                     | Single call. Typed record. Shared source of truth.                        |
| `snapshot().path.includes("active")`    | `matches(actor, "active")`                       | Works on actor directly. Dot-notation for hierarchies: `"idle.region.a"`. |
| Manual `.then()/.catch()` + abort check | `withPromise({ promise, signal, emit, events })` | Auto abort-aware. No forgotten `signal.aborted` guard.                    |
| Group states by variable naming         | `tag(stateA, stateB).has(snapshot)`              | Recursive matching. Works through parallel regions.                       |

No migration needed. Sugar wraps core. Use both side by side.

## License

MIT
