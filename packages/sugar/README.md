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

map.get("child1"); // the live child, or undefined
map.keys(); // ["child1"]
map.kill("child1");
```

`autoReap: true` removes a child once it reaches a final state.

**Typing children:** `ActorMap` is untyped by design. Check children with `snapshot()` + `isIn` / `matches`, or keep your own typed references.

### Embed: a state that runs another machine

`embed(m, { in, machine, done, error })` runs a child machine while the parent is in one state. Use it to split a big machine into smaller ones.

```ts
import { Actor, machine, state, event } from "@mantaq/core";
import { embed, withTimeout } from "@mantaq/sugar";

const working = state("working")();
const passed = state("passed")().final();
const finish = event("finish")();

const check = machine("check", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [finish],
      states: [working, passed],
      initial: working,
      clock,
      setup: (m) => {
        m.effect(working, {
          name: "wait",
          sends: [finish],
          fn: (input) => withTimeout(100, { input, event: () => finish.create() }),
        });
        m.on(working, { event: finish, to: [passed], handler: () => ({ state: passed }) });
      },
    }),
});

const checking = state("checking")();
const accepted = state("accepted")();
const broken = state("broken")();
const checkPassed = event("checkPassed")();
const checkBroke = event("checkBroke")();

const order = machine("order", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [checkPassed, checkBroke],
      states: [checking, accepted, broken],
      initial: checking,
      clock,
      setup: (m) => {
        embed(m, {
          in: checking,
          machine: check,
          done: { passed: checkPassed },
          error: checkBroke,
        });
        m.on(checking, {
          event: checkPassed,
          to: [accepted],
          handler: () => ({ state: accepted }),
        });
        m.on(checking, { event: checkBroke, to: [broken], handler: () => ({ state: broken }) });
      },
    }),
});
```

When the parent enters `checking`, embed builds the child with the clock of the parent. When the child enters the final state `passed`, the parent receives `checkPassed`. When the child enters `__error`, the parent receives `checkBroke`. When the parent leaves `checking`, embed disposes the child. The parent transitions are ordinary `m.on` calls, so the diagram shows their edges.

The types require these things:

- The parent has a clock. Embed never builds the child on real time.
- `done` has one event for each final state of the child.
- The `done` and `error` events are internal events of the parent, without a payload.
- The parent declares each output of the child as an input, an internal event or an output. Embed forwards each child output into the parent, as `regions` do.
- The factory of the child returns the actor, or `{ actor }` and nothing else. Embed disposes only the actor.

#### Forward user events and watch the child

A child often waits for the user, for example to retry or dismiss a failed upload. The user sends these events to the parent. `forward` lists the parent inputs that embed sends on to the running child. `snapshot` names a parent internal event that carries the snapshot of the child, so the parent can keep it in its context.

```ts
import { Actor, machine, state, event } from "@mantaq/core";
import type { Snapshot } from "@mantaq/core";
import { embed, withTimeout } from "@mantaq/sugar";

const uploading = state("uploading")();
const couldNotUpload = state("couldNotUpload")();
const uploaded = state("uploaded")().final();
const dismissed = state("dismissed")().final();
const uploadFailed = event("uploadFailed")();
const retry = event("retry")();
const dismiss = event("dismiss")();

const upload = machine("upload", {
  create: ({ clock }) =>
    Actor({
      inputs: [retry, dismiss],
      internal: [uploadFailed],
      states: [uploading, couldNotUpload, uploaded, dismissed],
      initial: uploading,
      clock,
      setup: (m) => {
        m.effect(uploading, {
          name: "upload",
          sends: [uploadFailed],
          fn: (input) => withTimeout(100, { input, event: () => uploadFailed.create() }),
        });
        m.on(uploading, {
          event: uploadFailed,
          to: [couldNotUpload],
          handler: () => ({ state: couldNotUpload }),
        });
        m.on(couldNotUpload, {
          event: retry,
          to: [uploading],
          handler: () => ({ state: uploading }),
        });
        m.on(couldNotUpload, {
          event: dismiss,
          to: [dismissed],
          handler: () => ({ state: dismissed }),
        });
      },
    }),
});

const editing = state("editing")();
const saving = state("saving")();
const saved = state("saved")();
const save = event("save")();
const uploadDone = event("uploadDone")();
const uploadDismissed = event("uploadDismissed")();
const uploadBroke = event("uploadBroke")();
const uploadChanged = event("uploadChanged")<Snapshot>();

interface EditorContext {
  upload: Snapshot | undefined;
}

const noUpload: EditorContext = { upload: undefined };

const editor = machine("editor", {
  create: ({ clock }) =>
    Actor({
      inputs: [save, retry, dismiss],
      internal: [uploadDone, uploadDismissed, uploadBroke, uploadChanged],
      states: [editing, saving, saved],
      initial: editing,
      context: noUpload,
      clock,
      setup: (m) => {
        m.on(editing, { event: save, to: [saving], handler: () => ({ state: saving }) });
        embed(m, {
          in: saving,
          machine: upload,
          done: { uploaded: uploadDone, dismissed: uploadDismissed },
          error: uploadBroke,
          forward: [retry, dismiss],
          snapshot: uploadChanged,
          keep: "upload",
        });
        m.on(saving, {
          event: uploadChanged,
          handler: (changed, { context }) => context.set({ upload: changed.payload }),
        });
        m.on(saving, { event: uploadDone, to: [saved], handler: () => ({ state: saved }) });
        m.on(saving, {
          event: uploadDismissed,
          to: [editing],
          handler: () => ({ state: editing }),
        });
        m.on(saving, { event: uploadBroke, to: [editing], handler: () => ({ state: editing }) });
      },
    }),
});
```

While the parent is in `saving`, `editor.send(retry.create())` goes to the child. The child handles it like any input: here it leaves `couldNotUpload` and uploads again. When the child ends in `dismissed`, the parent receives `uploadDismissed`. Outside `saving` there is no child, and the parent ignores `retry` like any input that it does not handle.

Embed registers a parent handler for each forwarded event in `in`. The handler keeps the parent in `in` and sends the event to the child. `actor.options.targets` lists each forwarded event on `in` with no targets, and the `embedded` tag lists them in `forward`. Do not add another handler for a forwarded event in `in`. The parent keeps one handler per state and event, so the handler that registers last replaces the other one. This also applies to a second `embed` on the same `in` that forwards the same event. An `onAny` handler for a forwarded event also runs, and if it leaves `in`, embed disposes the child.

The child handles a forwarded event before the parent handler returns. So when the child ends on a forwarded event, the parent handles the `done` event first. Transition subscribers of the parent see the `done` transition first, then the forwarded event, with `to` set to the state that the `done` event entered.

Embed sends `uploadChanged` to the parent when the child is built and again after each change of the child. Its payload is the snapshot of the child. The parent must handle it in `in`, as for any internal event. Here the handler keeps the snapshot in the context of the parent. Embed sends the first snapshot event on entry. If another effect of `in` sends an event that makes the parent leave `in` at once, register that effect after `embed`. Otherwise the queued snapshot event reaches the next state, which does not handle it, and the parent enters `__error`. A `done` event of a child that ends on entry behaves the same way. So `editor.snapshot().context.upload` always holds the last child snapshot, also for a subscriber that starts late. The UI shows the retry and dismiss buttons when the parent is in `saving` and the path of the child is `["couldNotUpload"]`. After the parent leaves `saving`, the field keeps the last snapshot of the child, so the UI must also check the state of the parent.

`keep` names the context field where the `snapshot` handler keeps the child snapshot, here `upload`. Embed does not write the field. It puts the name in the `embedded` tag as `keep`, so that tools can read the child state from the context of the parent. The live driver of `@mantaq/inspect` reads it to report the state of the child. `keep` needs `snapshot`.

A tool that drives the parent can put a function `childBuilt` on the effect input. Embed calls it with each child that it builds, before the child gets an event. The live driver of `@mantaq/inspect` uses it to hold the effects of the child.

The types also require these things:

- Each `forward` event is an input of the parent and an input of the child. The child input takes the payload of the parent event.
- The `snapshot` event is an internal event of the parent. Its payload type takes the snapshot of the child.
- The `keep` field is a field of the parent context. Its type takes the snapshot of the child.

Events reach the child only through `forward`. Nothing else sends events into the child.

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

### `embed(m, { in, machine, done, error, forward?, snapshot? })`

Run `machine` while the parent is in the state `in`. The pattern above shows a full example. Embed registers one effect on `in`, named `embed:<machine id>`. Its `sends` lists the `done` and `error` events and the `snapshot` event. It does not list the child outputs that embed passes to the parent. A tool finds those in `options.outputs` of the child. For each `forward` event, embed also registers a handler on `in` with no targets.

The effect fn has an `embedded` property. Tools such as `@mantaq/inspect` read it from `actor.options.effects` with `Reflect.get(entry.fn, "embedded")`, so they do not import sugar. The property has this shape (the `Embedded` type):

```ts
import type { Machine } from "@mantaq/core";

interface Embedded {
  machine: Machine; // the child machine, as given to embed
  done: Record<string, string>; // final state name of the child -> event type the parent receives
  error: string; // event type the parent receives when the child enters __error, or a final state done does not name
  forward: readonly string[]; // parent input types that embed sends to the child while the parent is in `in`
  snapshot: string | undefined; // parent internal event type that carries each child snapshot, or undefined
}
```

A live tool sends a forwarded event to the parent, as the UI does. To read the child state, it watches the `transition` subscribers of the parent for events whose type is `snapshot` from the tag, and reads their payload. When `in` is the initial state of the parent, the first snapshot event runs inside `Actor()`, before a tool can subscribe. The child state is then in the snapshot of the parent, but the tag does not say in which field. A parent without `snapshot` shows no child state, because the snapshot of the parent does not include the child.

The parent receives at most one `done` or `error` event per child. The child outputs that it emits while `machine.create()` runs are not forwarded, because embed subscribes after the child exists.

The effect returns `settled()` of the child, taken when the child is built. So `settled()` of the parent waits for async work that the child starts on entry. It does not wait for async work that the child starts later, for example after a timer fires on `clock.advance()`. To wait for that work, await the promise that the child effect waits on.

### `broadcast(map, event)`

Send an event to every key in an `ActorMap` (or any `SendableMap`):

```ts
import { broadcast } from "@mantaq/sugar";
import type { ActorMap } from "@mantaq/sugar";

declare const map: ActorMap;

broadcast(map, { type: "ping" });
```

Works with any object implementing `{ keys(): string[]; send(key, event): void }`.

### `createPool({ name, workers, run, keep?, key?, batch? })`

One inbox and `workers` workers (`w1`..`wn`) that pull work. The inbox hands items to free workers only; a failed run puts its items back at the front. Event ids are `${name}.ITEM_ARRIVED` and so on, so two pools with different names never cross.

```ts
import { createPool } from "@mantaq/sugar";

const pool = createPool<string, "team">({
  name: "team",
  workers: 3,
  run: async (items, { signal }) => {
    await fetch(`/work/${items[0]}`, { signal });
  },
});

pool.actor.send(pool.events.ITEM_ARRIVED.create({ item: "a" }));
```

`pool.actor` is the inbox (states `allWorkersFree`, `workersBusy`, `workWaiting`). `pool.workers` is an `ActorMap` (states `free`, `working`). `keep: "set"` skips an item whose `key` (default `JSON.stringify`) already waits. `batch` is the most items one worker takes (default 1; `Infinity` takes all). Waiting items live in memory: persisting them is the app's job.

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
