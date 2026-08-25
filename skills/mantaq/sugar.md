# Sugar Reference

Ergonomic layer over `@mantaq/core`. `npm install @mantaq/sugar`.

## Batch Creation

```ts
const s = states("idle", "running", "success"); // { idle: StateRef, running: StateRef, ... }
const e = events("START", "STOP"); // { START: EventRef, ... }
```

## Matching

```ts
matches(actor, "idle"); // snapshot().path[0] === "idle"
matches(actor, "drawer.open"); // dot path through regions
isIn(snapshot, "combat"); // any depth, any region
activeLeaves(snapshot); // ["drawer.open", "movement.idle"] — deepest active states
```

`matches` returns `false` for malformed patterns (empty, leading/trailing dots, `..`).

## Tags

Group states under one check. Handy for cross-region "is this family active" tests.

```ts
const dangerous = tag(state("attack")(), state("regen")());
dangerous.has(actor.snapshot());
```


## Dynamic Children (ActorMap)

Spawn/kill actors by key at runtime. Children wire output → parent.

```ts
const map = new ActorMap(parentActor);
map.spawn("order-1", () => new Actor({ ... }));
map.send("order-1", someEvent.create());
map.kill("order-1");              // aborts child effects
map.ensure("order-2", factory);   // spawn if missing
map.snapshot("order-1");
```

## Dynamic Children (ActorMap)

Spawn/kill actors by key at runtime. Children wire output → parent.

```ts
const map = new ActorMap(parentActor);
map.spawn("order-1", () => new Actor({ ... }));
map.send("order-1", someEvent.create());
map.kill("order-1");              // aborts child effects
map.ensure("order-2", factory);   // spawn if missing
map.snapshot("order-1");
```

## Broadcast

Send one event to every actor in a map (or any `{ keys(), send() }`):

```ts
broadcast(map, shutdownEvent); // SendableEvent = EventRef | { type, payload? }
```

## Effect Helpers

```ts
// fire one event after ms (injected clock — deterministic in tests)
m.effect(submittingState, {
  name: "startSubmitTimeout",
  fn: (input) => withTimeout(800, input, () => ({ type: "SUBMITTING_DONE" })),
});

// resolve a promise → emit success/error event (guarded by abort signal)
withPromise(promise, signal, emit, {
  success: (data) => ({ type: "FETCH_OK", payload: data }),
  error: (err) => ({ type: "FETCH_ERR", payload: err }),
});
```

`withTimeout`'s timer is NOT removed on abort. The callback no-ops via
`signal.aborted`. For immediate removal, pass the signal to
`clock.setTimeout` or clear in an abort listener.

## Conventions

- Prefer sugar over raw core. Less ceremony, same semantics.
- `ActorMap`, `broadcast`, `tag` are newer; reach for them when the need arises, not preemptively.
