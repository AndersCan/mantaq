# Testing Mantaq

Deterministic tests with the VirtualClock + vitest. Harness and coverage from `@mantaq/test` (`npm install @mantaq/test`) and `@mantaq/traversal`. Written against `@mantaq/core` 0.4, `@mantaq/test` 1.0, `@mantaq/traversal` 0.2. Check exact signatures against the installed types.

## Deterministic Tests (VirtualClock)

Never real timers in tests. Inject `VirtualClock`, jump with `advance`.

```ts
import { Actor, VirtualClock } from "@mantaq/core";
import { matches } from "@mantaq/sugar";

const clock = VirtualClock();
const actor = Actor({ clock, ... });

actor.send(submit.create({ ... }));
clock.advance(800);                       // fires timers, drains queue — synchronous
expect(matches(actor, "success")).toBe(true);
```

No awaits needed for timer work. For promise-based effects, `await actor.settled()`. Pending timers are not queued events, so `settled()` does not advance time.

Assert no leaked timers at the end of a test with the clock's pending-timer inspection (`hasPending`, `pendingTimers`).

## Failure-Path Injection

`actor.send()` only accepts declared input events. To exercise an error branch, inject an internal event by id through the harness's `send` (or the actor's `inject`):

```ts
import { createTestHarness } from "@mantaq/test";

const h = createTestHarness(actor);
h.send({ type: "CONNECTION_FAILED" });
clock.advance(2000);
expect(matches(actor, "reconnecting")).toBe(true);
```

Use this for internal failure events (`PAYMENT_FAILED`, timeouts, retries) without forcing failures through the public API.

## Assertions

- `matches(actor, "state.path")`. Sugar state check.
- `actor.snapshot()`: path, context, regions, `done`, `error`. Snapshot context is a copy.
- `actor.context`: live accumulated data.

## Coverage (Harness + Traversal)

Prove behavior, don't just assert happy paths. The harness records visited states, fired transitions and executed effects, and offers `assert*` / `was*` helpers plus a `coverage()` report:

```ts
const h = createTestHarness(actor);
h.send(someEvent.create());
clock.advance(800);

h.coverage();
h.assertAllStatesVisited();
h.assertAllTransitionsVisited();
```

Other assertions cover a specific state, transition or effect being visited or never visited, and a context predicate that must never hold. List them from the `@mantaq/test` types; they take option objects.

`@mantaq/traversal` exposes graph algorithms (reachability, paths, cycles, unreachable states). Use unreachable-state analysis to find states you declared but never wired.

## Test Design

- Happy path + every failure arc. Each error state needs a test that reaches it.
- Assert on state, not on internal wiring. `matches` + `done` cover most.
- Pin simulated randomness. Keep simulation effects' randomness contained so actor logic stays deterministic.
