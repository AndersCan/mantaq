# Testing Mantaq

Deterministic tests with the VirtualClock + vitest. Harness and coverage from `@mantaq/test` (`npm install @mantaq/test`) and `@mantaq/traversal`.

## Deterministic Tests (VirtualClock)

Never real timers in tests. Inject `VirtualClock`, jump with `advance`.

```ts
import { describe, it, expect } from "vitest";
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";

const clock = new VirtualClock();
const actor = new Actor({ clock, ... });

actor.send(submit.create({ ... }));
clock.advance(800);                       // fires timers, drains queue — synchronous
expect(matches(actor, "success")).toBe(true);
```

No awaits needed with VirtualClock. Everything runs synchronously in one
call stack: `send()` drains immediately, `advance()` fires due timers
and drains each fire. `settled()` resolves on queue drain only. Pending
timers are not queued events. Don't `await settled()` expecting timer
work done.

Clock extras: `clock.hasPending()`, `clock.pendingTimers()` (assert no leaked timers), `clock.now()`.

## Failure-Path Injection

`actor.send()` only accepts input events (typed). To exercise an error
branch, drive the failure event through the harness. It dispatches any
event id at runtime:

```ts
import { createTestHarness } from "@mantaq/test";

const h = createTestHarness(actor);
h.send({ type: "CONNECTION_FAILED" }); // same as actor.send, but any id
clock.advance(2000);
expect(matches(actor, "reconnecting")).toBe(true);
```

Use this to test internal failure events (`PAYMENT_FAILED`, timeouts, retries) without forcing failures through the public API.

## Assertions

- `matches(actor, "state.path")`. Sugar state check.
- `actor.snapshot()` → `{ path, context, regions, done }`. `done` true in final state.
- `expect(actor.context.x).toEqual(...)`. Accumulated data.

## Coverage (Harness + Traversal)

Prove behavior, don't just assert happy paths.

```ts
const h = createTestHarness(actor);
h.send(someEvent.create());
clock.advance(800);

h.coverage(); // states + transitions exercised
h.assertAllStatesVisited();
h.assertAllTransitionsVisited();
h.assertStateVisited("error");
h.assertTransitionNeverVisited("idle", "START");
h.assertEffectRan("submitting");
h.assertContextNever((c) => c.broken);
```

Harness exposes `history` (visit/transition/effect records), `graph`, `reset()`. Assertion names in `@mantaq/test`'s index.

Traversal algorithms direct (from `@mantaq/traversal`): `reachable`,
`allPaths`, `findCycles`, `unreachableNodes`, `shortestPath`.
`unreachableNodes` finds declared-but-unreachable states. States you
declared but never wired.

## Test Design

- Happy path + every failure arc. Each error state needs a test that reaches it.
- Assert on state, not on internal wiring. `matches` + `done` cover most.
- Verify no leaked timers at the end of tests (`clock.hasPending()`).
- Simulated randomness: pin it (`vi.spyOn(Math, "random")`). Keep
  simulation effects' randomness contained so the actor logic stays
  deterministic.
