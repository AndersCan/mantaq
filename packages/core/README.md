# @mantaq/core

State machine library. Small API surface — cook the primitives, not the framework.

## Install

```bash
npm install @mantaq/core
```

## Quick Reference

| Pattern         | Correct                            | Anti-pattern                           |
| --------------- | ---------------------------------- | -------------------------------------- |
| Type context    | `context: {} as MyContext`         | casting in every handler               |
| Type events     | `event("ID")<Payload>()`           | `event("ID")()` without generic        |
| Send events     | `actor.send(event.create(data))`   | raw `{ id: "ID", ... }` objects        |
| Effect data     | Use state payload                  | Depend on `event` in effect            |
| Error handling  | Emit internal event                | Throw in effect or transition          |
| Internal events | Declare in `internal: [...]`       | Put user events in internal            |
| Signal check    | `if (signal.aborted) return`       | Skip abort check in async work         |
| Regions         | Child outputs in parent `internal` | Forget to declare child outputs        |
| Snapshot        | Save path + context manually       | Expect `snapshot()` to include context |
| Any handler     | Universal events only (CANCEL)     | State-specific logic in `onAny`        |

## Contents

- [Install](#install)
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
  - [Any Handler](#any-handler)
  - [Testing with VirtualClock](#testing-with-virtualclock)
- [Development](#development)
- [License](#license)

## Quick Start

Transitions and effects are registered in a `setup` callback. The builder is
type-safe: targets validate against your declared `states`, `inputs`, and
`internal` events at compile time.

```ts
import { Actor, state, event } from "@mantaq/core";

const idle = state("idle")();
const active = state("active")();
const toggle = event("TOGGLE")();

const actor = new Actor({
  inputs: [toggle],
  states: [idle, active],
  initial: idle,
  setup: (m) => {
    m.on(idle, toggle, () => ({ state: active }));
    m.on(active, toggle, () => ({ state: idle }));
  },
});

actor.on("change", (snap) => console.log(snap.path)); // fires immediately: ["idle"]
actor.send(toggle.create());
// "change" fires again: ["active"]
```

## Docs

See [anderscan.github.io/mantaq](https://anderscan.github.io/mantaq) for full documentation.

## Patterns

### Typed Actor Context

Cast the context type once at the constructor level. Handlers receive the typed context automatically — no casting needed per-handler.

```ts
interface AuthContext {
  user?: User;
  phoneNumber?: string;
}

const actor = new Actor({
  inputs: [signInEvent],
  states: [idleState, signingInState],
  initial: idleState,
  context: {} as AuthContext,
  setup: (m) => {
    m.on(idleState, signInEvent, (event, opts) => {
      opts!.context.phoneNumber = event.phoneNumber; // ✅ typed
      return { state: signingInState };
    });
  },
});
```

**Anti-pattern — casting in every handler:**

```ts
setup: (m) => {
  m.on(idleState, signInEvent, (event, opts) => {
    const c = opts!.context as AuthContext; // ❌ unnecessary — already typed
    c.phoneNumber = event.phoneNumber;
    return { state: signingInState };
  });
},
```

### Proper Event Typing

Define events with `event("ID")<Payload>()`. The payload type flows through to handlers automatically.

```ts
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
const signOutEvent = event("SIGN_OUT")(); // no payload
const dataEvent = event("DATA_LOADED")<{ items: string[]; count: number }>();

// Creating events
actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
actor.send(signOutEvent.create()); // no payload
```

Handlers receive the correct payload type:

```ts
setup: (m) => {
  m.on(idleState, signInEvent, (event) => {
    event.phoneNumber; // ✅ string
    return { state: signingInState };
  });
},
```

**Anti-pattern — skipping the generic parameter:**

```ts
// ❌ payload is `unknown`, no type safety
const badEvent = event("SIGN_IN")();

// ✅ always provide the payload type
const goodEvent = event("SIGN_IN")<{ phoneNumber: string }>();
```

**Anti-pattern — sending raw objects instead of using `.create()`:**

```ts
// ✅ typed
actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));

// ❌ bypasses type checking
actor.send({ id: "SIGN_IN", phoneNumber: "+1234567890" });
```

### Effects and Event Typing

Effects run when entering a state. The `event` parameter in effects is typed as the union of all possible events (`Inputs[number] | Internal[number]`) — not the specific event that triggered the transition. This is by design: effects live on states, not transitions. Multiple transitions can lead to the same state, so the effect cannot know which event caused entry.

**Pass data to effects via state payload.** Set the payload in the transition return, read it from `state.payload` in the effect.

```ts
const loadingState = state("loading")<{ url: string }>();
const loadedState = state("loaded")();
const fetchEvent = event("FETCH")<{ url: string }>();
const doneEvent = event("LOADED")();

const actor = new Actor({
  inputs: [fetchEvent],
  internal: [doneEvent],
  states: [idleState, loadingState, loadedState],
  initial: idleState,
  setup: (m) => {
    m.effect(loadingState, ({ state, emit, clock }) => {
      // state.payload is typed to the state's declared payload: { url: string }
      const url = state.payload.url;
      clock.setTimeout(1000, () => {
        emit(doneEvent.create());
      });
    });
    m.on(idleState, fetchEvent, (event) => {
      return { state: loadingState.create({ url: event.url }) };
    });
    m.on(loadingState, doneEvent, () => ({ state: loadedState }));
  },
});
```

**Context is also possible but less precise.** Context is shared across all states — writing to context in one state leaks into others. Prefer state payload for data that belongs to a specific state entry.

```ts
// ✅ state payload — scoped to this state entry
return { state: loadingState.create({ url: event.url }) };

// ⚠️ context — works but shared across all states
opts!.context.url = event.url;
return { state: loadingState };
```

**Anti-pattern — depending on `event` in effects:**

```ts
m.effect(loadingState, ({ event, emit }) => {
  // ❌ event is the union type, not the specific triggering event
  // event.url doesn't exist on the union
  emit(doneEvent.create()); // fine — but event.url would be a type error
});
```

The `event` parameter exists for convenience (e.g., logging), not for business logic. Use state payload or context to pass data to effects.

### Two-Queue Architecture

Mantaq uses two event queues: **external** (user-sent) and **internal** (effect-emitted). Understanding the difference prevents subtle bugs.

**External events** are sent via `actor.send()` — they trigger transitions on the current state.

**Internal events** are emitted from effects via `emit()` — they are queued and processed after the current transition completes.

```ts
const tickEvent = event("TICK")();
const connectEvent = event("CONNECT")();

const actor = new Actor({
  inputs: [connectEvent], // external — user triggers
  internal: [tickEvent], // internal — effects emit
  states: [idleState, connectedState],
  initial: idleState,
  setup: (m) => {
    m.effect(idleState, ({ emit, clock }) => {
      clock.setTimeout(1000, () => {
        emit(tickEvent.create()); // goes to internal queue
      });
    });
    m.on(idleState, connectEvent, () => ({ state: connectedState })); // external handler
    m.on(idleState, tickEvent, () => ({})); // internal handler
  },
});
```

**Ordering:** External events process one at a time. Internal events emitted during a transition process depth-first after that transition. Internal events from effects process after the effect completes — this is a common source of bugs. If an effect emits an internal event and the actor is in a different state by the time that event processes, the handler may not exist or may behave unexpectedly.

**Anti-pattern — mixing internal/external incorrectly:**

```ts
// ❌ declaring a user-sent event as internal
internal: [connectEvent], // user can't send internal events via actor.send()

// ✅ keep external events in inputs
inputs: [connectEvent],
```

### Effect Pattern

Effects run on state entry. They receive typed context, an AbortSignal, and an emit function.

```ts
type MyContext = { retryCount: number; maxRetries: number };

const startEvent = event("START")();
const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

function createActor() {
  return new Actor({
    inputs: [startEvent],
    internal: [doneEvent, failedEvent],
    states: [idleState, workingState, doneState, errorState],
    initial: idleState,
    context: { retryCount: 0, maxRetries: 3 } as MyContext,
    setup: (m) => {
      m.effect(workingState, ({ signal, context, emit, clock }) => {
        // context is MyContext — typed from the constructor generic
        if (context.retryCount >= context.maxRetries) {
          emit(failedEvent.create({ error: "Max retries exceeded" }));
          return;
        }

        clock.setTimeout(2000, () => {
          if (signal.aborted) return; // ✅ check signal before emitting
          emit(doneEvent.create());
        });
      });
      m.on(idleState, startEvent, () => ({ state: workingState }));
      m.on(workingState, doneEvent, () => ({ state: doneState }));
      m.on(workingState, failedEvent, (_event, opts) => {
        opts!.context.retryCount++;
        return { state: errorState };
      });
    },
  });
}
```

**Anti-pattern — not checking `signal.aborted`:**

```ts
m.effect(workingState, ({ signal, emit, clock }) => {
  // ❌ if state changes before timeout, this still fires
  clock.setTimeout(2000, () => {
    emit(doneEvent.create());
  });
});
```

```ts
m.effect(workingState, ({ signal, emit, clock }) => {
  // ✅ guard with abort check
  clock.setTimeout(2000, () => {
    if (signal.aborted) return;
    emit(doneEvent.create());
  });
});
```

### Snapshot & Restore

`actor.snapshot()` returns a serializable `Snapshot` — `{ path, regions, done? }`. It does **not** include context. Use it to save/restore actor state across sessions.

```ts
interface SerializedActor {
  path: string[];
  regions: Record<string, unknown>;
  context: Record<string, unknown>;
}

function saveActor(actor: { snapshot(): Snapshot; context: unknown }): SerializedActor {
  return {
    ...actor.snapshot(),
    context: { ...(actor.context as Record<string, unknown>) },
  };
}

// Usage
const saved = saveActor(actor);
localStorage.setItem("actor", JSON.stringify(saved));

const raw = localStorage.getItem("actor");
if (raw) {
  const data = JSON.parse(raw) as SerializedActor;
  // restore from data.path and data.context
}
```

**Anti-pattern — trying to snapshot context via `snapshot()`:**

```ts
// ❌ snapshot() only returns path + regions, not context
const snap = actor.snapshot();
snap.context; // doesn't exist

// ✅ serialize context yourself
const stateData = {
  path: actor.snapshot().path,
  context: { ...actor.context },
};
```

### Dynamic Children (Regions)

Regions let you compose actors. The parent actor manages child lifecycle; child outputs are routed as parent internal events.

```ts
const healthCheckResult = event("HEALTH_CHECK_RESULT")<{ healthy: boolean }>();

const healthMonitor = new Actor({
  inputs: [healthCheckResult],
  states: [unknownState, healthyState, degradedState],
  initial: unknownState,
  setup: (m) => {
    m.on(unknownState, healthCheckResult, (event) => ({
      state: event.healthy ? healthyState : degradedState,
    }));
    m.on(healthyState, healthCheckResult, (event) => ({
      state: event.healthy ? healthyState : degradedState,
    }));
  },
});

const manager = new Actor({
  inputs: [connectEvent],
  internal: [healthCheckResult], // child output must be declared here
  states: [disconnectedState, connectedState],
  initial: disconnectedState,
  regions: { health: healthMonitor }, // child named "health"
  setup: (m) => {
    m.on(connectedState, healthCheckResult, (event, opts) => {
      // access child via actor.regions
      manager.regions.health.send(healthCheckResult.create({ healthy: event.healthy }));
      return {};
    });
  },
});

// Query child state with dot notation (matches is from @mantaq/sugar)
matches(manager, "connected.health.healthy"); // ✅
```

**Anti-pattern — child outputs not declared as parent internal events:**

```ts
const child = new Actor({
  outputs: [someOutputEvent], // child emits this
  // ...
});

// ❌ parent doesn't declare it as internal — event gets dropped
const parent = new Actor({
  internal: [], // missing!
  regions: { child },
});

// ✅ child output must be in parent's internal array
const parent = new Actor({
  internal: [someOutputEvent],
  regions: { child },
});
```

### Error Handling

Never throw from effects or transitions. Emit an error as an internal event and let a transition handle it. Errors thrown inside a handler or effect have no subscriber — the machine just stops applying it.

Catch errors inside effects and emit recovery events:

```ts
const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

setup: (m) => {
  m.effect(workingState, ({ signal, emit, clock }) => {
    clock.setTimeout(100, () => {
      if (signal.aborted) return;
      try {
        const result = riskyOperation();
        emit(doneEvent.create());
      } catch (err) {
        // ✅ emit error as internal event — lets transition handle it
        emit(failedEvent.create({ error: String(err) }));
      }
    });
  });
  m.on(workingState, doneEvent, () => ({ state: doneState }));
  m.on(workingState, failedEvent, (event) => {
    // handle error in transition, not in effect
    return { state: errorState.create({ error: event.error }) };
  });
},
```

**Anti-pattern — re-throwing in effects:**

```ts
try {
  const result = riskyOperation();
  emit(doneEvent.create());
} catch (err) {
  throw err; // ❌ throw in effect — no handler, machine misbehaves
}
```

**Anti-pattern — throwing in transition handlers:**

```ts
m.on(idleState, submitEvent, (event) => {
  if (!event.data) throw new Error("missing data"); // ❌ breaks the machine
  return { state: doneState };
});
```

Prefer storing the error in context and transitioning to an error state:

```ts
m.on(idleState, submitEvent, (event, opts) => {
  if (!event.data) {
    opts!.context.error = "missing data";
    return { state: errorState };
  }
  return { state: doneState };
});
```

### Any Handler

Use `onAny` to intercept events across all states — useful for universal error handling, cleanup, or logging.

```ts
setup: (m) => {
  // CANCEL works from any state
  m.onAny(cancelEvent, (_event, opts) => {
    opts!.context.cancelled = true;
    return { state: cancelledState };
  });
  // State-specific handlers still run for their state
  m.on(idleState, startEvent, () => ({ state: runningState }));
},
```

**Anti-pattern — using `onAny` for everything:**

```ts
setup: (m) => {
  // ❌ state-specific logic in onAny defeats the purpose
  m.onAny(submitBasicInfoEvent, (event, opts) => {
    opts!.context.basicInfo = event; // wrong — only makes sense in basicInfo state
    return { state: shippingAddressState };
  });

  // ✅ keep state-specific logic in state handlers
  m.on(basicInfoState, submitBasicInfoEvent, (event, opts) => {
    opts!.context.basicInfo = event;
    return { state: shippingAddressState };
  });
},
```

### Testing with VirtualClock

`VirtualClock` replaces real timers for deterministic tests. Advance time manually, verify state instantly.

#### Basic Usage

```ts
import { Actor, VirtualClock, state, event } from "@mantaq/core";

const clock = new VirtualClock();
const timer = event("timer")();

const idle = state("idle")();
const timedOut = state("timedOut")();

const actor = new Actor({
  inputs: [],
  internal: [timer],
  states: [idle, timedOut],
  initial: idle,
  clock,
  setup: (m) => {
    m.effect(idle, ({ emit, clock }) => {
      clock.setTimeout(5000, () => emit(timer.create()));
    });
    m.on(idle, timer, () => ({ state: timedOut }));
  },
});

expect(actor.state.name).toBe("idle");

clock.advance(5000);
expect(actor.state.name).toBe("timedOut");
expect(clock.hasPending()).toBe(false);
```

**Anti-pattern — using `new Date()` or `setTimeout` directly:**

```ts
// ❌ real timers — slow, flaky, non-deterministic
setTimeout(() => {
  expect(actor.state.name).toBe("timedOut");
}, 5000);

// ✅ VirtualClock — instant, deterministic
clock.advance(5000);
expect(actor.state.name).toBe("timedOut");
```

#### Abort Signal Cleanup

The effect's abort signal fires on state exit. Clear timers in an abort listener so they don't fire later.

```ts
const cancel = event("cancel")();
const done = event("done")();
const loading = state("loading")();
const success = state("success")();

const actor = new Actor({
  inputs: [cancel],
  internal: [done],
  states: [loading, success],
  initial: loading,
  clock,
  setup: (m) => {
    m.effect(loading, ({ signal, clock }) => {
      const id = clock.setTimeout(5000, () => {
        /* ... */
      });
      signal.addEventListener("abort", () => clock.clearTimeout(id));
    });
    m.on(loading, cancel, () => ({ state: success }));
  },
});

// transition to success before the timer fires — abort signal clears it
actor.send(cancel.create());
clock.advance(10000);
expect(clock.hasPending()).toBe(false);
```

#### Interval Testing

`advance()` fires intervals at each elapsed tick. Multiple calls accumulate.

```ts
const tick = event("tick")();
let count = 0;

const active = state("active")();

const actor = new Actor({
  inputs: [],
  internal: [tick],
  states: [active],
  initial: active,
  clock,
  setup: (m) => {
    m.effect(active, ({ emit, clock }) => {
      clock.setInterval(1000, () => emit(tick.create()));
    });
    m.on(active, tick, () => {
      count++;
      return {};
    });
  },
});

clock.advance(3500);
expect(count).toBe(3); // fired at 1000, 2000, 3000
```

**Anti-pattern — expecting single `advance` to fire interval once:**

```ts
// ❌ advance(5000) fires interval at 1000, 2000, 3000, 4000, 5000
clock.advance(5000);
expect(count).toBe(1); // fails — count is 5

// ✅ match exact ticks or use setTimeout for single fire
clock.advance(1000);
expect(count).toBe(1);
```

## Development

```bash
vp install
vp test
vp pack
```

## License

MIT
