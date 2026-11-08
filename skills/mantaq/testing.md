# Testing Mantaq

Deterministic tests with the VirtualClock + vitest. Harness and coverage from `@mantaq/test` (`npm install @mantaq/test`) and `@mantaq/traversal`. Check exact signatures against the installed types.

## Deterministic Tests (VirtualClock)

Never real timers in tests. Inject `VirtualClock`, jump with `advance`.

```ts
import { Actor, VirtualClock } from "@mantaq/core";
import { matches } from "@mantaq/sugar";

const clock = VirtualClock();
const actor = Actor({ clock, ... });

actor.send(submit.create({ ... }));
clock.advance(800);                       // fires timers, drains queue — synchronous
expect(matches(actor, "submitted")).toBe(true);
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

## Record Runs

Wrap the machine factory once per test file. Each passing test that builds an actor with it is recorded as a named run in `__runs__/<test file>.json`, which the live page lists.

```ts
import { recordRuns } from "@mantaq/inspect/record";

const make = recordRuns(createInviteLinkActor);
```

Run the whole test file to refresh the sidecar, and commit it. With `CI` set, a stale file fails the test. Name tests as user-visible journeys: the test name is the run's label. Link a run as `?machine=<id>&run=<name>`.

A journey through an effect's answer injects that answer right after the send that started the effect: `actor.send(turnOffLink.create(...)); actor.inject({ type: "linkOffFailed", payload: { folderId } });`. Do not await between the two, or the real answer arrives first.

## Design Gate

```ts
import { expectAllStatesReached, expectNoDesignErrors, expectReached } from "@mantaq/inspect";

const target = { id: "inviteLink", create: () => createInviteLinkActor({ clock: VirtualClock() }) };
expectNoDesignErrors(target); // fuzzes: handler throws, unhandled effect sends, dead ends, unreachable states, events no state handles; with `source`: vague or undocumented names, handlers and effects
expectAllStatesReached(target);
expectReached(target, { transitions: [{ from: "waitingForAnswer", event: "ACCEPT" }] });
expectNoDesignErrors({ ...target, fuzz: false }); // structure only, no fuzzing
```

Fuzz throws in app code are real findings: fix them, never suppress.

Bad data without a crash: export `<machine id>Expectations` beside the factory, `payment: { neverSee: [{ address: "" }] }` typed `Expectations<typeof createXActor>`.
`mustSee` lists contexts some run must reach. Tests can pass the block as `expectations` on the target.
Payloads come from `source`; without it, payload events are sent without one.

With `@mantaq/test` 2.0 the `*` any-node (`m.onAny`) counts in coverage: it is one node, covered once its event fires from any state.

## Test Design

- Happy path + every failure arc. Each error state needs a test that reaches it.
- Assert on state, not on internal wiring. `matches` + `done` cover most.
- Pin simulated randomness. Keep simulation effects' randomness contained so actor logic stays deterministic.
