# @mantaq/core

State machine library. Small API surface. Cook the primitives, not the framework.

## Install

```bash
npm install @mantaq/core
```

**Using an AI agent?** Install the mantaq skill: `npx skills add AndersCan/mantaq`.

## See your machine

`@mantaq/inspect` draws every exported machine on your Vite dev server, fuzzes it, and lets you walk it.

```bash
npm install -D @mantaq/inspect vite
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { mantaqViz } from "@mantaq/inspect/vite";

export default defineConfig({
  plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })],
});
```

Run `npx vite` and open `http://localhost:5173/__mantaq/?machine=<id>`. The id is the export name without `create` / `Actor`: `createCheckoutActor` → `checkout`. Export a factory that takes a `VirtualClock` so the page can run and fuzz it. See [`@mantaq/inspect`](https://www.npmjs.com/package/@mantaq/inspect).

## Quick Reference

| Pattern         | Correct                                            | Anti-pattern                          |
| --------------- | -------------------------------------------------- | ------------------------------------- |
| Type context    | `const c: MyContext = {...}`, `context: c`         | `as` cast on the context value        |
| Write context   | `const s = context.get(); s.x = y; context.set(s)` | mutate without `set()`                |
| Type events     | `event("ID")<Payload>()`                           | untyped payloads                      |
| Send events     | `actor.send(signInEvent.create(data))`             | raw `{ type: "ID", payload }` objects |
| Transitions     | `m.on(state, { event, to: [next], handler })`      | returning a state not listed in `to`  |
| Effect data     | Use state payload                                  | Depend on `event` in effect           |
| Error handling  | Emit internal event                                | Throw in effect or transition         |
| Internal events | Declare in `internal: [...]`                       | Put user events in internal           |
| Timers          | `clock.setTimeout(ms, { cb, signal })`             | global `setTimeout`                   |
| Regions         | Child outputs in parent `internal`                 | Forget to declare child outputs       |
| Snapshot        | `snapshot()` carries path + context + payload      | Re-serialize context by hand          |
| Any handler     | Universal events only (CANCEL)                     | State-specific logic in `onAny`       |

## Contents

- [Install](#install)
- [See your machine](#see-your-machine)
- [Quick Reference](#quick-reference)
- [Quick Start](#quick-start)
- [Docs](#docs)
- [Patterns](#patterns)
  - [Typed Actor Context](#typed-actor-context)
  - [Proper Event Typing](#proper-event-typing)
  - [Effects and Event Typing](#effects-and-event-typing)
  - [Two-Queue Architecture](#two-queue-architecture)
  - [Effect Pattern](#effect-pattern)
  - [Snapshot & Restore](#snapshot--restore)
  - [Dynamic Children (Regions)](#dynamic-children-regions)
  - [Error Handling](#error-handling)
  - [Reading state in a UI](#reading-state-in-a-ui)
  - [Any Handler](#any-handler)
  - [Testing with VirtualClock](#testing-with-virtualclock)
- [Development](#development)
- [Testing](#testing)
- [License](#license)

## Quick Start

Transitions and effects are registered in a `setup` callback. The builder is
type-safe: `event` must be one of your `inputs` or `internal` events, and the
handler may only return states listed in `to` (no `to` means it can only stay).

```ts
import { Actor, state, event } from "@mantaq/core";

const idle = state("idle")();
const active = state("active")();
const toggle = event("TOGGLE")();

const actor = Actor({
  inputs: [toggle],
  states: [idle, active],
  initial: idle,
  setup: (m) => {
    m.on(idle, { event: toggle, to: [active], handler: () => ({ state: active }) });
    m.on(active, { event: toggle, to: [idle], handler: () => ({ state: idle }) });
  },
});

actor.on("change", { fn: (snap) => console.log(snap.path) });
actor.send(toggle.create()); // logs ["active"]
actor.state.name; // "active"
```

## Docs

See [anderscan.github.io/mantaq](https://anderscan.github.io/mantaq) for full documentation.

## Patterns

### Typed Actor Context

Declare the context value with its type once, then pass it to `Actor`. Handlers receive the typed context automatically. `as` on the context is an anti-pattern: it hides missing fields.

```ts
import { Actor, state, event } from "@mantaq/core";

interface AuthContext {
  phoneNumber?: string;
}

const idleState = state("idle")();
const signingInState = state("signingIn")();
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();

const initialContext: AuthContext = {};

const actor = Actor({
  inputs: [signInEvent],
  states: [idleState, signingInState],
  initial: idleState,
  context: initialContext,
  setup: (m) => {
    m.on(idleState, {
      event: signInEvent,
      to: [signingInState],
      handler: (event, { context }) => {
        // ✅ typed: context.get()/set() carry AuthContext
        const s = context.get();
        s.phoneNumber = event.payload.phoneNumber;
        context.set(s);
        return { state: signingInState };
      },
    });
  },
});

actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
actor.context.phoneNumber; // "+1234567890"
```

Context is user land. Mutate it freely. `set()` is the write signal: any `set()` triggers `change`, even with the same reference. Call it after you mutate. Mutating without `set()` never signals, so subscribers and persistence stay silent.

**Anti-pattern.** Casting the context (`context.get() as AuthContext`) in a handler. It is already typed; the cast only hides mistakes.

### Proper Event Typing

Define events with `event("ID")<Payload>()`. The payload type flows through to handlers and `.create()`.

```ts
import { event } from "@mantaq/core";

const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
const signOutEvent = event("SIGN_OUT")(); // no payload
const dataEvent = event("DATA_LOADED")<{ items: string[]; count: number }>();

signInEvent.create({ phoneNumber: "+1234567890" });
signOutEvent.create();
dataEvent.create({ items: ["a"], count: 1 });

// @ts-expect-error: a payload-less event takes no payload
signOutEvent.create({ phoneNumber: "+1234567890" });

// @ts-expect-error: the payload is checked
signInEvent.create({ phone: 1 });
```

Handlers receive the payload type: in `m.on(idleState, { event: signInEvent, handler: (event) => ... })`, `event.payload.phoneNumber` is a `string`.

**Anti-pattern. Sending raw objects instead of `.create()`.** `actor.send({ type: "SIGN_IN", payload })` has the right shape, but `signInEvent.is()` rejects it: `.create()` brands the event. Always send `ref.create(...)`.

### Effects and Event Typing

Effects run when entering a state. The `event` parameter in effects is typed `InternalEvent`, `{ type, payload? }` with `payload: unknown`, not the specific event that triggered the transition. This is by design: effects live on states, not transitions. Multiple transitions can lead to the same state, so the effect cannot know which event caused entry.

**Pass data to effects via state payload.** Return `state.create(payload)` from the transition, read `state.payload` in the effect.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";

const idleState = state("idle")();
const loadingState = state("loading")<{ url: string }>();
const loadedState = state("loaded")();
const fetchEvent = event("FETCH")<{ url: string }>();
const doneEvent = event("LOADED")();

const actor = Actor({
  inputs: [fetchEvent],
  internal: [doneEvent],
  states: [idleState, loadingState, loadedState],
  initial: idleState,
  clock: VirtualClock(),
  setup: (m) => {
    m.effect(loadingState, {
      name: "fetchUrl",
      sends: [doneEvent],
      fn: ({ state, emit, clock, signal }) => {
        // state.payload is typed to the state's declared payload: { url: string }
        console.log("loading", state.payload.url);
        clock.setTimeout(1000, { signal, cb: () => emit(doneEvent.create()) });
      },
    });
    m.on(idleState, {
      event: fetchEvent,
      to: [loadingState],
      handler: (event) => ({ state: loadingState.create({ url: event.payload.url }) }),
    });
    m.on(loadingState, {
      event: doneEvent,
      to: [loadedState],
      handler: () => ({ state: loadedState }),
    });
  },
});
```

**Context is also possible but less precise.** Context is shared across all states. Writing to context in one state leaks into others. Prefer state payload for data that belongs to a specific state entry.

The `event` parameter in an effect exists for convenience (e.g., logging), not for business logic. Use state payload or context to pass data to effects.

### Two-Queue Architecture

Mantaq uses two event queues: **external** (user-sent) and **internal** (effect-emitted). Understanding the difference prevents subtle bugs.

**External events** are sent via `actor.send()` and must be declared in `inputs`. They trigger transitions on the current state.

**Internal events** are emitted from effects via `emit()` and must be declared in `internal`. They are queued and processed after the current transition completes.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";

const idleState = state("idle")();
const connectedState = state("connected")();
const tickEvent = event("TICK")();
const connectEvent = event("CONNECT")();

const actor = Actor({
  inputs: [connectEvent], // external: user triggers
  internal: [tickEvent], // internal: effects emit
  states: [idleState, connectedState],
  initial: idleState,
  clock: VirtualClock(),
  setup: (m) => {
    m.effect(idleState, {
      name: "scheduleTick",
      sends: [tickEvent],
      fn: ({ emit, clock, signal }) => {
        clock.setTimeout(1000, { signal, cb: () => emit(tickEvent.create()) }); // internal queue
      },
    });
    m.on(idleState, {
      event: connectEvent,
      to: [connectedState],
      handler: () => ({ state: connectedState }),
    });
    m.on(idleState, { event: tickEvent, handler: () => ({}) }); // stays in idle
  },
});

actor.send(connectEvent.create());
// @ts-expect-error: internal events cannot be sent from outside
actor.send(tickEvent.create());
```

**Ordering:** External events process one at a time. Internal events emitted during a transition process depth-first after that transition. Internal events from effects process after the effect completes. If an effect emits an internal event and the actor is in a different state by the time that event processes, the handler may not exist: an internal event with no handler routes the machine to `__error` (`reason: "unhandled"`). Pass `signal` to timers so they are cleared on state exit.

### Effect Pattern

Effects run on state entry. They receive the typed context, an `AbortSignal`, the clock, and an `emit` function. Each effect carries a required camelCase `name` describing what it does. Tests can assert on it (`harness.assertEffectRan(stateName, effectName)`), and executed effects appear in history as `{ stateName, effectName }`. `sends` lists the internal events the effect may emit; `emit` then only accepts those.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";

type MyContext = { retryCount: number; maxRetries: number };

const idleState = state("idle")();
const workingState = state("working")();
const doneState = state("done")().final();
const errorState = state("error")();

const startEvent = event("START")();
const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

export function createWorkerActor(clock = VirtualClock()) {
  const initialContext: MyContext = { retryCount: 0, maxRetries: 3 };
  return Actor({
    inputs: [startEvent],
    internal: [doneEvent, failedEvent],
    states: [idleState, workingState, doneState, errorState],
    initial: idleState,
    context: initialContext,
    clock,
    setup: (m) => {
      m.effect(workingState, {
        name: "attemptWork",
        sends: [doneEvent, failedEvent],
        fn: ({ signal, context, emit, clock }) => {
          const { retryCount, maxRetries } = context.get();
          if (retryCount >= maxRetries) {
            emit(failedEvent.create({ error: "Max retries exceeded" }));
            return;
          }
          // ✅ signal clears the timer when the state exits
          clock.setTimeout(2000, { signal, cb: () => emit(doneEvent.create()) });
        },
      });
      m.on(idleState, {
        event: startEvent,
        to: [workingState],
        handler: () => ({ state: workingState }),
      });
      m.on(workingState, {
        event: doneEvent,
        to: [doneState],
        handler: () => ({ state: doneState }),
      });
      m.on(workingState, {
        event: failedEvent,
        to: [errorState],
        handler: (_event, { context }) => {
          const s = context.get();
          s.retryCount += 1;
          context.set(s);
          return { state: errorState };
        },
      });
    },
  });
}
```

**Anti-pattern. Timers without `signal`.** `clock.setTimeout(2000, { cb })` still fires after the state exits. Pass `signal`, or check `signal.aborted` in the callback, or `clock.clearTimeout(id)` in an abort listener.

### Snapshot & Restore

`actor.snapshot()` returns a `Snapshot`: `{ path, context, payload?, regions, done?, error? }`. Context is included; `payload` is the payload the current state was entered with (present only when the transition carried one). Use it to save/restore actor state across sessions.

```ts
import type { Snapshot } from "@mantaq/core";

declare const actor: { snapshot(): Snapshot<{ count: number }> };

// Snapshot carries path, context, and regions: serialize it directly
const saved = actor.snapshot();
localStorage.setItem("actor", JSON.stringify(saved));

const raw = localStorage.getItem("actor");
if (raw) {
  const data: Snapshot<{ count: number }> = JSON.parse(raw);
  // rebuild the actor at data.path[0], seeded with data.context
  console.log(data.path, data.context.count);
}
```

`snapshot().context` already holds the context. No manual step needed.

### Dynamic Children (Regions)

Regions compose actors. The parent owns the child's lifecycle; the child's `outputs` reach the parent as internal events, so declare them in the parent's `internal`.

```ts
import { Actor, state, event } from "@mantaq/core";
import { matches } from "@mantaq/sugar";

const healthCheck = event("HEALTH_CHECK")<{ healthy: boolean }>();
const degraded = event("DEGRADED")();
const connectEvent = event("CONNECT")();

const unknownState = state("unknown")();
const healthyState = state("healthy")();
const degradedState = state("degraded")();

const healthMonitor = Actor({
  inputs: [healthCheck],
  outputs: [degraded],
  states: [unknownState, healthyState, degradedState],
  initial: unknownState,
  setup: (m) => {
    m.on(unknownState, {
      event: healthCheck,
      to: [healthyState, degradedState],
      handler: (event) =>
        event.payload.healthy
          ? { state: healthyState }
          : { state: degradedState, emit: [degraded.create()] },
    });
  },
});

const disconnectedState = state("disconnected")();
const connectedState = state("connected")();

const manager = Actor({
  inputs: [connectEvent],
  internal: [degraded], // ✅ child output declared here, or it is dropped
  states: [disconnectedState, connectedState],
  initial: disconnectedState,
  regions: { health: healthMonitor }, // child named "health"
  setup: (m) => {
    m.on(disconnectedState, {
      event: connectEvent,
      to: [connectedState],
      handler: () => ({ state: connectedState }),
    });
    m.on(connectedState, {
      event: degraded,
      to: [disconnectedState],
      handler: () => ({ state: disconnectedState }),
    });
  },
});

manager.send(connectEvent.create());
manager.regions.health?.send(healthCheck.create({ healthy: true }));
// Query child state with dot notation: state.regionKey.childState
matches(manager, "connected.health.healthy"); // true
```

### Error Handling

Never throw from effects or transitions. Emit an error as an internal event and let a transition handle it. If user code throws anyway, the machine does **not** misbehave silently: it dies into a built-in terminal `__error` state, records `snapshot().error` (the thrown value, the state/context at the point of failure, the bad event), drops remaining events, and ignores later `send`s. Errors never escape `send()` and the machine stays deterministic. Same inputs, same trace.

```ts
import type { Snapshot } from "@mantaq/core";

declare const snap: Snapshot;

if (snap.error) {
  snap.error.reason; // "transition" | "effect" | "budget" | "output" | "internal" | "async" | "unhandled"
  snap.error.state.name; // the state at the point of failure
  snap.error.event.type; // the bad event
}
```

Two deliberate exceptions to "every failure is loud":

- **Subscribers only watch.** They read snapshots and never change the machine, so a throwing `on("change")`/`on("done")`/`on("transition")`/`on("error")` callback is swallowed. The machine and its callers are unaffected.
- **Unhandled external events are ignored.** An event with no handler in the current state is dropped by design (broadcast fan-out, cross-state sends). An **internal** event with no handler, however, is a machine-authoring bug and routes to the error state (`reason: "unhandled"`).

A dead machine can be manually resumed with `actor.recover({ state, context })`. An explicit, **inherently dangerous** escape hatch (the caller injects state and context, so determinism no longer holds). Effects are not re-run and timers are not re-armed; processing resumes on the next event. Prefer fixing the root cause and recreating the actor.

Catch errors inside effects and emit recovery events:

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";

declare function riskyOperation(): void;

const workingState = state("working")();
const doneState = state("done")().final();
const errorState = state("error")<{ error: string }>();
const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

Actor({
  inputs: [],
  internal: [doneEvent, failedEvent],
  states: [workingState, doneState, errorState],
  initial: workingState,
  clock: VirtualClock(),
  setup: (m) => {
    m.effect(workingState, {
      name: "runRiskyOperation",
      sends: [doneEvent, failedEvent],
      fn: ({ signal, emit, clock }) => {
        clock.setTimeout(100, {
          signal,
          cb: () => {
            try {
              riskyOperation();
              emit(doneEvent.create());
            } catch (err) {
              // ✅ emit the error as an internal event; a transition handles it
              emit(failedEvent.create({ error: String(err) }));
            }
          },
        });
      },
    });
    m.on(workingState, {
      event: doneEvent,
      to: [doneState],
      handler: () => ({ state: doneState }),
    });
    m.on(workingState, {
      event: failedEvent,
      to: [errorState],
      handler: (event) => ({ state: errorState.create({ error: event.payload.error }) }),
    });
  },
});
```

**Anti-pattern.** Re-throwing in an effect, or throwing in a transition handler (`if (!event.payload.data) throw ...`). Either kills the machine into `__error`. Return an error state instead (`{ state: errorState.create({ error: "missing data" }) }`), or store the error in context and transition.

### Reading state in a UI

`actor.state.name` is the typed state name: a union of your declared states plus `"__error"`. Read it, not `snapshot().path[0]`, which is an untyped `string`.

```ts
import { Actor, state, event } from "@mantaq/core";

declare function show(name: string): void;

const idle = state("idle")();
const toggle = event("TOGGLE")();
const actor = Actor({ inputs: [toggle], states: [idle], initial: idle, setup: () => {} });

const render = () => show(actor.state.name); // "idle" | "__error"
actor.on("change", { fn: render });
render();
```

Two different failures need two different responses:

- **Dead machine.** `actor.state.name === "__error"` (details in `snapshot().error`). A handler threw and the actor is terminal. Create a new actor and offer Reload.
- **Failed state the machine models.** An `error` state reached through a failure event is an ordinary state. Render it like any other state.

`recover()` is not for UIs: it breaks determinism. Recreate the actor instead.

To bind any actor without naming `Actor`'s five generics, type the binder on the parts it uses:

```ts
import type { Snapshot } from "@mantaq/core";

export function bind<
  A extends {
    state: { name: string };
    on(event: "change", options: { fn: () => void }): () => void;
    snapshot(): Snapshot<unknown>;
  },
>(actor: A, render: (name: A["state"]["name"]) => void): () => void {
  const paint = () => render(actor.state.name);
  paint();
  return actor.on("change", { fn: paint });
}
```

### Any Handler

Use `onAny` to intercept an event in every state. Useful for universal cancel, cleanup, or logging. A state's own `m.on` for the same event wins.

```ts
import { Actor, state, event } from "@mantaq/core";

const idleState = state("idle")();
const runningState = state("running")();
const cancelledState = state("cancelled")().final();
const startEvent = event("START")();
const cancelEvent = event("CANCEL")();

const initialContext: { cancelled: boolean } = { cancelled: false };

Actor({
  inputs: [startEvent, cancelEvent],
  states: [idleState, runningState, cancelledState],
  initial: idleState,
  context: initialContext,
  setup: (m) => {
    // CANCEL works from any state
    m.onAny({
      event: cancelEvent,
      to: [cancelledState],
      handler: (_event, { context }) => {
        const s = context.get();
        s.cancelled = true;
        context.set(s);
        return { state: cancelledState };
      },
    });
    m.on(idleState, {
      event: startEvent,
      to: [runningState],
      handler: () => ({ state: runningState }),
    });
  },
});
```

**Anti-pattern. Using `onAny` for everything.** State-specific logic (submitting a form step) belongs in `m.on(thatState, ...)`. In `onAny` it runs in states where it makes no sense, and the diagram can only draw it as "from any state".

### Testing with VirtualClock

`VirtualClock()` replaces real timers for deterministic tests. Advance time manually, verify state instantly. Without `clock`, an actor uses the real clock.

#### Basic Usage

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { expect } from "vitest";

const clock = VirtualClock();
const timer = event("timer")();

const idle = state("idle")();
const timedOut = state("timedOut")();

const actor = Actor({
  inputs: [],
  internal: [timer],
  states: [idle, timedOut],
  initial: idle,
  clock,
  setup: (m) => {
    m.effect(idle, {
      name: "armIdleTimeout",
      sends: [timer],
      fn: ({ emit, clock, signal }) => {
        clock.setTimeout(5000, { signal, cb: () => emit(timer.create()) });
      },
    });
    m.on(idle, { event: timer, to: [timedOut], handler: () => ({ state: timedOut }) });
  },
});

expect(actor.state.name).toBe("idle");

clock.advance(5000);
expect(actor.state.name).toBe("timedOut");
expect(clock.hasPending()).toBe(false);
```

**Anti-pattern.** Global `setTimeout` or `new Date()` in effects or tests: slow, flaky, non-deterministic. Use the effect's `clock` and `clock.advance(ms)` in tests.

#### Abort Signal Cleanup

The effect's abort signal fires on state exit. Timers armed with `signal` are cleared then.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { expect } from "vitest";

const clock = VirtualClock();
const cancel = event("cancel")();
const done = event("done")();
const loading = state("loading")();
const success = state("success")();

const actor = Actor({
  inputs: [cancel],
  internal: [done],
  states: [loading, success],
  initial: loading,
  clock,
  setup: (m) => {
    m.effect(loading, {
      name: "scheduleWork",
      sends: [done],
      fn: ({ signal, clock, emit }) => {
        clock.setTimeout(5000, { signal, cb: () => emit(done.create()) });
      },
    });
    m.on(loading, { event: cancel, to: [success], handler: () => ({ state: success }) });
    m.on(loading, { event: done, to: [success], handler: () => ({ state: success }) });
  },
});

// leave loading before the timer fires: the abort signal clears it
actor.send(cancel.create());
clock.advance(10000);
expect(clock.hasPending()).toBe(false);
```

#### Interval Testing

`advance()` fires intervals at each elapsed tick. Multiple calls accumulate.

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";
import { expect } from "vitest";

const clock = VirtualClock();
const tick = event("tick")();
const active = state("active")();
let count = 0;

Actor({
  inputs: [],
  internal: [tick],
  states: [active],
  initial: active,
  clock,
  setup: (m) => {
    m.effect(active, {
      name: "startTicker",
      sends: [tick],
      fn: ({ emit, clock, signal }) => {
        clock.setInterval(1000, { signal, cb: () => emit(tick.create()) });
      },
    });
    m.on(active, {
      event: tick,
      handler: () => {
        count++;
        return {};
      },
    });
  },
});

clock.advance(3500);
expect(count).toBe(3); // fired at 1000, 2000, 3000
```

`advance(5000)` on a 1000ms interval fires five times, not once. Advance by exact ticks, or use `setTimeout` for a single fire.

## Development

From the [repo](https://github.com/AndersCan/mantaq) (contributors):

```bash
vp install
vp test
vp pack
```

## Testing

The package ships with a full test suite you can run and audit from the repo:

```bash
vp test          # feature + error + property tests
vp check         # format, lint, typecheck (includes type-level contract tests)
vp run mutation:core   # mutation score must stay ≥ the break threshold
```

**Test contract.** Behavior is pinned by four kinds of tests, split by filename:

- `*.test.ts`. Features and happy paths, hand-maintained.
- `*.error.test.ts`. Failure paths: warnings, budgets, abort, unregistered, the `__error` state.
- `*.property.test.ts`. Property-based invariants against a reference model (fast-check, replayable via `MANTAQ_SEED`).
- `*.mutation.test.ts`. Directed tests that kill specific mutants. Regenerable and thrown away between stryker runs.

Coverage is analyzed per test (stryker `perTest` coverage analysis) so every mutant is attributed to the test that pins it. A change that drops the mutation score below the break threshold (`stryker.config.json`) fails the build.

## License

MIT
