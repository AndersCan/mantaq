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
import { states, events, matches, tag } from "@mantaq/sugar";
import { Actor } from "@mantaq/core";

const s = states("idle", "loading", "success", "error");
const e = events("fetch", "resolve", "fail");

const machine = new Actor({
  inputs: [e.fetch],
  outputs: [],
  internal: [],
  context: {},
  states: [s.idle, s.loading, s.success, s.error],
  initial: s.idle,
  effects: {},
  transitions: {
    idle: { fetch: () => ({ state: s.loading }) },
    loading: {
      resolve: () => ({ state: s.success }),
      fail: () => ({ state: s.error }),
    },
    success: {},
    error: {},
  },
});

matches(machine, "loading"); // true
```

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
import { ActorMap, matches } from "@mantaq/sugar";

const map = new ActorMap(); // or new ActorMap(parentActor)

map.spawn("child1", () => childActor);
map.spawn("child2", () => otherActor);

map.send("child1", someEvent);
map.kill("child2");
map.keys(); // ["child1"]
map.snapshot("child1"); // Snapshot | undefined
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
e.click.create({ x: 1, y: 2 }); // { id: "click", x: 1, y: 2 }
e.click.is(emittedEvent); // boolean
```

### `onSuccess(result, emit, eventFn)`

Emit a success event from a resolved value:

```ts
import { onSuccess } from "@mantaq/sugar";

onSuccess(data, emit, (d) => ({ id: "fetched", data: d }));
```

### `onError(err, emit, eventFn)`

Emit an error event from a caught error:

```ts
import { onError } from "@mantaq/sugar";

onError(err, emit, (e) => ({ id: "fetchFailed", reason: String(e) }));
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

**Anti-pattern:** Don't use `onSuccess`/`onError` inside a `.then()/.catch()` chain manually — use `withPromise` instead. It handles abort awareness automatically.

### `withTimeout(ms, input, eventFn)`

Schedule a timeout event through the actor's clock. Aborts cleanly if the actor is destroyed before timeout fires.

```ts
import { withTimeout } from "@mantaq/sugar";

withTimeout(5000, input, () => ({ id: "timeout", reason: "exceeded" }));
```

## License

MIT
