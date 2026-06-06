# Feature: `snapshot.matches()` / `state.matches()`

## Problem

Currently, checking if an actor is in a specific state requires manual path inspection:

```ts
// Flat — ok
actor.state.name === "loading";

// Hierarchical — verbose
const snap = actor.snapshot();
snap.path[0] === "connected" && snap.regions.default?.path[0] === "active";

// Parallel — worse
snap.regions.playback?.path[0] === "playing" && snap.regions.audio?.path[0] === "muted";
```

XState solves this with `state.matches("loggedIn")` and `state.matches("loggedIn.authenticated")`. Dot-notation traversal. Natural for conditional rendering, guards, testing.

## Design

### API

```ts
// On snapshot
snapshot.matches("submitting"); // flat check
snapshot.matches("connected.active"); // hierarchical — region name dot-notation
snapshot.matches("player.playback.playing"); // parallel — region dot-notation
snapshot.matches("root.level2.level1"); // deep nesting

// On actor (convenience — delegates to snapshot)
actor.matches("submitting");
actor.matches("connected.active");
```

### Semantics

`matches(pattern)` splits on `.`, walks the snapshot tree:

1. First segment = top-level state name (`path[0]`)
2. Each subsequent segment = region name lookup in `regions`
3. Leaf reached → `true` if path segment matches leaf state name
4. Prefix match: `matches("connected")` returns `true` if snapshot is anywhere inside `connected` (any region state)

```ts
// Snapshot: { path: ["connected"], regions: { default: { path: ["active"], regions: {} } } }
matches("connected"); // true — top-level match
matches("connected.active"); // true — exact region match
matches("connected.idle"); // false — wrong region state
matches("player"); // false — wrong top-level
```

### Implementation

```ts
// Add to Snapshot interface
matches(pattern: string): boolean;

// Or standalone function
matches(snapshot: Snapshot, pattern: string): boolean;
```

Recursive walk:

```ts
function matches(snapshot: Snapshot, pattern: string): boolean {
  const parts = pattern.split(".");

  // Check top-level state name
  if (snapshot.path[0] !== parts[0]) return false;

  // No more parts — we matched the top-level
  if (parts.length === 1) return true;

  // Walk regions for remaining parts
  const regionName = parts[1];
  const regionSnap = snapshot.regions[regionName];
  if (!regionSnap) return false;

  // Recurse with remaining path
  const remaining = parts.slice(1).join(".");
  return matches(regionSnap, remaining);
}
```

### Prefix Matching vs Exact Matching

Two possible semantics:

| Pattern                   | Snapshot `connected.active.idle` | Semantics                  |
| ------------------------- | -------------------------------- | -------------------------- |
| `"connected"`             | `true`                           | Prefix — in subtree        |
| `"connected.active"`      | `true`                           | Prefix — deeper in subtree |
| `"connected.active.idle"` | `true`                           | Exact leaf                 |

This is the XState behavior. `matches("X")` = "am I anywhere inside X?"

**Alternative: exact match only**

| Pattern              | Snapshot `connected.active` | Semantics               |
| -------------------- | --------------------------- | ----------------------- |
| `"connected"`        | `false`                     | Must match leaf exactly |
| `"connected.active"` | `true`                      | Exact leaf match        |

Recommendation: **prefix match** (XState-compatible). More useful for conditional rendering:

```tsx
// React example
if (actor.matches("submitting")) {
  return <Spinner />;
}
if (actor.matches("error")) {
  return <ErrorBanner />;
}
```

### Type Safety (Stretch)

Given `StateNames` union type, constrain pattern string:

```ts
matches(pattern: StateNames | `${StateNames}.${string}`): boolean;
```

Requires recursive mapped type to generate all valid dot-path combinations from region definitions. Complex but possible with conditional types.

### Implementation Options

**Option A: Method on Snapshot class**

```ts
// Wrap Snapshot in a class
class SnapshotImpl implements Snapshot {
  matches(pattern: string): boolean { ... }
}
```

Pro: Clean API. Con: Changes Snapshot from plain object to class instance.

**Option B: Standalone function**

```ts
import { matches } from "mantaq";
matches(actor.snapshot(), "submitting");
```

Pro: No class change. Con: Verbose.

**Option C: Method on Actor, delegates**

```ts
// Actor gets matches() convenience
actor.matches(pattern: string): boolean {
  return matchesSnapshot(this.snapshot(), pattern);
}
```

Pro: `actor.matches("X")` is clean. Snapshot stays plain object (JSON-serializable). Internal helper does the work.

**Option D: Both**

```ts
// Snapshot stays plain object for serialization
// Actor has convenience method
actor.matches("submitting"); // preferred
matches(actor.snapshot(), "submitting"); // also available
```

### Recommendation

**Option D** — Actor gets `matches()`, standalone `matches(snapshot, pattern)` function exported for edge cases. Snapshot stays plain object (important for serialization, devtools, logging).

## Edge Cases

1. **Empty pattern** `""` → `false`
2. **Trailing dot** `"submitting."` → `false`
3. **Unknown region name** `"connected.nonexistent"` → `false`
4. **Parallel regions** — pattern walks one region chain. `matches("player.playback.playing")` checks playback region only, ignores audio.
5. **Empty regions** `{}` — any pattern beyond top-level → `false`

## Testing

```ts
test("matches flat state", () => {
  const snap = { path: ["idle"], regions: {} };
  expect(matches(snap, "idle")).toBe(true);
  expect(matches(snap, "active")).toBe(false);
});

test("matches hierarchical — prefix", () => {
  const snap = {
    path: ["connected"],
    regions: { default: { path: ["active"], regions: {} } },
  };
  expect(matches(snap, "connected")).toBe(true);
  expect(matches(snap, "connected.active")).toBe(true);
  expect(matches(snap, "connected.idle")).toBe(false);
});

test("matches parallel — region chain", () => {
  const snap = {
    path: ["player"],
    regions: {
      playback: { path: ["playing"], regions: {} },
      audio: { path: ["muted"], regions: {} },
    },
  };
  expect(matches(snap, "player.playback.playing")).toBe(true);
  expect(matches(snap, "player.audio.muted")).toBe(true);
  expect(matches(snap, "player.playback.paused")).toBe(false);
});
```

## Relationship to `isIn`

Plan.md mentions `snapshot.isIn(stateRef)`. Two APIs:

- `matches(pattern)` — string-based, flexible, good for runtime/JSX
- `isIn(stateRef)` — ref-based, type-safe, good for guards/conditionals

Both can coexist. `matches` is sugar over `isIn` for string patterns.

## Files Affected

- `packages/core/src/actor.ts` — add `matches()` method to Actor
- `packages/core/src/snapshot.ts` — new file with `matches()` standalone function
- `packages/core/src/index.ts` — export `matches`
- Tests — new test file or add to existing

---

# Feature: Effect Helpers — onError / onSuccess from a Promise

## Problem

Effects are synchronous — they set up work and return. For promise-based async (fetch, DB calls, etc.), authors end up with repetitive try/catch or `.then/.catch` wiring in every effect:

```ts
loading: [
  ({ signal, emit, clock }) => {
    callApi("/api/data")
      .then((r) => {
        emit(fetchSuccess.create(r));
      })
      .catch((e) => {
        emit(fetchError.create({ message: String(e) }));
      });
  },
],
```

Boilerplate. Every effect with a promise repeats the same shape.

## Design

### API

User-land helper functions that take a promise result and an `emit` function:

```ts
function onSuccess<T>(result: T, emit: (e: any) => void) {
  emit(fetchSuccess.create(result));
}

function onError(err: unknown, emit: (e: any) => void) {
  emit(fetchError.create({ message: String(err) }));
}
```

Usage in effect:

```ts
loading: [
  ({ signal, emit, clock }) => {
    callApi("/api/data")
      .then((r) => onSuccess(r, emit))
      .catch((e) => onError(e, emit));
  },
],
```

### Variants

**Inline — no helpers, just pattern:**

```ts
loading: [
  ({ emit }) => {
    callApi(url)
      .then((r) => emit(fetchSuccess.create(r)))
      .catch((e) => emit(fetchError.create({ message: String(e) })));
  },
],
```

**Typed helpers — generic over event:**

```ts
function onSuccess<T>(result: T, emit: (e: any) => void, event: (data: T) => any) {
  emit(event(result));
}

// Usage
callApi(url).then((r) => onSuccess(r, emit, fetchSuccess.create));
```

**With loading state:**

```ts
function withPromise<T>(
  promise: Promise<T>,
  emit: (e: any) => void,
  events: {
    success: (data: T) => any;
    error: (err: unknown) => any;
  },
) {
  return promise
    .then((data) => emit(events.success(data)))
    .catch((err) => emit(events.error(err)));
}

// Usage
loading: [
  ({ emit }) => {
    withPromise(callApi(url), emit, {
      success: fetchSuccess.create,
      error: (e) => fetchError.create({ message: String(e) }),
    });
  },
],
```

### Recommendation

**No helpers in core.** The pattern is thin enough to inline:

```ts
.then((r) => emit(successEvent.create(r)))
.catch((e) => emit(errorEvent.create({ message: String(e) })));
```

If teams have many effects, define helpers in shared utils — not in the library. The core provides `emit` and `{ signal }` for cancellation. Routing outcomes is application logic.

## Edge Cases

1. **Unhandled rejection** — if neither `.catch` nor `onError` handler, promise rejection is unhandled. Effect should always handle both paths.
2. **Multiple emits** — helpers can emit multiple events (e.g., set loading=false AND set data). Compose freely.
3. **Abort signal** — if signal fires mid-flight, `.then` may still run. Guard with `signal.aborted` check or use `AbortController` with the fetch itself.

## Files Affected

- None — this is a user-land pattern, not a library change.
- Document in README under "User Land Features".
