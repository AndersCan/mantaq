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
| Any handler     | Universal events only (CANCEL)     | State-specific logic in Any            |

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
    - [Error Event Subscription](#error-event-subscription)
    - [Effect Error Recovery](#effect-error-recovery)
    - [Transition Error Handling](#transition-error-handling)
    - [Nested Error Propagation](#nested-error-propagation)
  - [Any Handler](#any-handler)
- [Development](#development)
- [License](#license)

## Quick Start

```ts
import { Actor, state, event } from "@mantaq/core";

const idle = state("idle")();
const active = state("active")();
const toggle = event("TOGGLE")();

const actor = new Actor({
  inputs: [toggle],
  states: [idle, active],
  initial: idle,
  transitions: {
    idle: { TOGGLE: () => ({ state: active }) },
    active: { TOGGLE: () => ({ state: idle }) },
  },
});

actor.on("change", (snap) => console.log(snap.path)); // ["idle"]
actor.send(toggle);
```

## Docs

See [mantaq.dev](https://mantaq.dev) for full documentation.

## Patterns

### Typed Actor Context

Cast the context type once at the constructor level. Handlers receive the typed context automatically — no casting needed per-handler.

```ts
interface AuthContext {
  user?: User;
  phoneNumber?: string;
}

const actor = new Actor({
  context: {} as AuthContext,
  transitions: {
    idle: {
      SIGN_IN: (evt, { context }) => {
        context.phoneNumber = evt.phoneNumber; // ✅ typed
        return { state: signingInState };
      },
    },
  },
});
```

**Anti-pattern — casting in every handler:**

```ts
transitions: {
  idle: {
    SIGN_IN: (evt, { context }) => {
      const c = context as AuthContext; // ❌ don't do this
      c.phoneNumber = evt.phoneNumber;
      return { state: signingInState };
    },
  },
}
```

### Proper Event Typing

Define events with `event("ID")<Payload>()`. The payload type flows through to handlers automatically.

```ts
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
const signOutEvent = event("SIGN_OUT")(); // no payload
const dataEvent = event("DATA_LOADED")<{ items: string[]; count: number }>();

// Creating events
actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));
actor.send(signOutEvent); // no payload, send ref directly
```

Handlers receive the correct payload type:

```ts
transitions: {
  idle: {
    SIGN_IN: (event, { context }) => {
      event.phoneNumber; // ✅ string
      return { state: signingInState };
    },
  },
}
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

const actor = new Actor({
  states: [idleState, loadingState],
  initial: idleState,
  effects: {
    loading: [
      ({ state, emit, clock }) => {
        // state.payload is typed as unknown — cast to the known type
        const { url } = state.payload as { url: string };
        clock.setTimeout(1000, () => {
          emit({ id: "LOADED", result: url });
        });
      },
    ],
  },
  transitions: {
    idle: {
      FETCH: (event) => {
        return { state: loadingState, payload: { url: event.url } };
      },
    },
  },
});
```

**Context is also possible but less precise.** Context is shared across all states — writing to context in one state leaks into others. Prefer state payload for data that belongs to a specific state entry.

```ts
// ✅ state payload — scoped to this state entry
return { state: loadingState, payload: { url: event.url } };

// ⚠️ context — works but shared across all states
context.url = event.url;
return { state: loadingState };
```

**Anti-pattern — depending on `event` in effects:**

```ts
effects: {
  loading: [
    ({ event, emit }) => {
      // ❌ event is the union type, not the specific triggering event
      // event.url doesn't exist on the union
      emit({ id: "LOADED", result: event.url }); // type error
    },
  ],
}
```

The `event` parameter exists for convenience (e.g., logging), not for business logic. Use state payload or context to pass data to effects.

### Two-Queue Architecture

Mantaq uses two event queues: **external** (user-sent) and **internal** (effect-emitted). Understanding the difference prevents subtle bugs.

**External events** are sent via `actor.send()` — they trigger transitions on the current state.

**Internal events** are emitted from effects via `emit()` — they process after the current transition completes.

```ts
const tickEvent = event("TICK")();
const connectEvent = event("CONNECT")();

const actor = new Actor({
  inputs: [connectEvent], // external — user triggers
  internal: [tickEvent], // internal — effects emit
  effects: {
    idle: [
      ({ emit, clock }) => {
        clock.setTimeout(1000, () => {
          emit(tickEvent.create(undefined)); // goes to internal queue
        });
      },
    ],
  },
  transitions: {
    idle: {
      CONNECT: () => ({ state: connectedState }), // external handler
      TICK: () => ({}), // internal handler
    },
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

const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

function createActor() {
  return new Actor({
    inputs: [],
    internal: [doneEvent, failedEvent],
    states: [idleState, workingState, doneState, errorState],
    initial: idleState,
    context: { retryCount: 0, maxRetries: 3 } as MyContext,
    effects: {
      working: [
        ({ signal, context, emit, clock }) => {
          // context is MyContext — typed from Actor generic
          if (context.retryCount >= context.maxRetries) {
            emit(failedEvent.create({ error: "Max retries exceeded" }));
            return;
          }

          clock.setTimeout(2000, () => {
            if (signal.aborted) return; // check signal before emitting
            emit(doneEvent.create(undefined));
          });
        },
      ],
    },
    transitions: {
      idle: {
        START: () => ({ state: workingState }),
      },
      working: {
        WORK_DONE: () => ({ state: doneState }),
        WORK_FAILED: (_event, { context }) => {
          context.retryCount++;
          return { state: errorState };
        },
      },
    },
  });
}
```

**Anti-pattern — not checking `signal.aborted`:**

```ts
effects: {
  working: [
    ({ signal, emit, clock }) => {
      // ❌ if state changes before timeout, this still fires
      clock.setTimeout(2000, () => {
        emit(doneEvent.create(undefined));
      });
    },
  ],
}
```

```ts
effects: {
  working: [
    ({ signal, emit, clock }) => {
      // ✅ guard with abort check
      clock.setTimeout(2000, () => {
        if (signal.aborted) return;
        emit(doneEvent.create(undefined));
      });
    },
  ],
}
```

### Snapshot & Restore

`actor.snapshot()` returns a serializable `Snapshot`. Use it to save/restore actor state across sessions.

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

Regions let you compose actors. The parent actor manages child lifecycle; child outputs are routed as internal events.

```ts
const tierActor = new Actor({
  inputs: [],
  outputs: [],
  internal: [],
  states: [l1State, l2State],
  initial: l1State,
  context: {},
  effects: {},
  transitions: { l1: {}, l2: {} },
});

const parent = new Actor({
  inputs: [],
  outputs: [],
  internal: [],
  states: [readyState, busyState],
  initial: readyState,
  context: {} as ParentContext,
  regions: { tier: tierActor }, // child named "tier"
  effects: {},
  transitions: {
    ready: {
      SWITCH_TIER: (_event, { actor }) => {
        // access child via actor.regions
        return {};
      },
    },
  },
});

// Query child state with dot notation
matches(parent, "ready.tier.l1"); // ✅
matches(parent, "ready.tier.l2"); // ✅

// Access child actor instance
const tierChild = parent.regions["tier"];
```

**Anti-pattern — child outputs not declared as parent internal events:**

```ts
const child = new Actor({
  outputs: [someOutputEvent], // child emits this
  // ...
});

// ❌ parent doesn't declare it as internal — event gets lost
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

#### Error Event Subscription

Subscribe to `"error"` to catch effect errors. The callback receives the error object.

```ts
const actor = new Actor({
  /* ... */
});

actor.on("error", (err) => {
  console.error("Effect error:", err);
  // send to crash reporting, trigger fallback, etc.
});

// ✅ subscribe before starting — errors during startup need handlers too
```

**Anti-pattern — subscribing after error occurs:**

```ts
actor.send(startEvent); // effect runs, throws
// ❌ no subscriber yet — error is silently dropped
actor.on("error", (err) => console.error(err));

// ✅ subscribe first, then send
actor.on("error", (err) => console.error(err));
actor.send(startEvent);
```

#### Effect Error Recovery

Catch errors inside effects and emit recovery events. Never let errors propagate unhandled.

```ts
const doneEvent = event("WORK_DONE")();
const failedEvent = event("WORK_FAILED")<{ error: string }>();

effects: {
  working: [
    ({ signal, emit, clock }) => {
      clock.setTimeout(100, () => {
        if (signal.aborted) return;
        try {
          const result = riskyOperation();
          emit(doneEvent.create({ result }));
        } catch (err) {
          // ✅ emit error as internal event — lets transition handle it
          emit(failedEvent.create({ error: String(err) }));
        }
      });
    },
  ],
}

transitions: {
  working: {
    WORK_DONE: (event) => {
      return { state: doneState, payload: { result: event.result } };
    },
    WORK_FAILED: (event) => {
      // handle error in transition, not in effect
      return { state: errorState, payload: { error: event.error } };
    },
  },
}
```

**Anti-pattern — re-throwing in effects:**

```ts
effects: {
  working: [
    ({ signal, emit, clock }) => {
      clock.setTimeout(100, () => {
        if (signal.aborted) return;
        try {
          const result = riskyOperation();
          emit(doneEvent.create({ result }));
        } catch (err) {
          throw err; // ❌ throw in effect goes to error subscriber, not transition
        }
      });
    },
  ],
}
```

#### Transition Error Handling

Never throw from transition handlers. Return error state or store error in context.

```ts
type MyContext = { error?: string };

transitions: {
  idle: {
    SUBMIT: (event, { context }) => {
      if (!event.data) {
        // ✅ store error, transition to error state
        context.error = "missing data";
        return { state: errorState };
      }
      if (!isValid(event.data)) {
        context.error = "invalid data";
        return { state: errorState };
      }
      return { state: doneState };
    },
  },
  error: {
    RETRY: (_event, { context }) => {
      context.error = undefined;
      return { state: idleState };
    },
  },
}
```

**Anti-pattern — throwing in transition handlers:**

```ts
transitions: {
  idle: {
    SUBMIT: (event) => {
      if (!event.data) throw new Error("missing data"); // ❌ breaks state machine
      return { state: doneState };
    },
  },
}
```

#### Nested Error Propagation

Errors in child regions bubble up to the parent. Subscribe to parent errors to catch child failures.

```ts
const childEffect = ({ emit }) => {
  // this will throw
  throw new Error("child broke");
};

const child = new Actor({
  states: [idleState],
  initial: idleState,
  effects: { idle: [childEffect] },
  transitions: { idle: {} },
});

const parent = new Actor({
  states: [idleState],
  initial: idleState,
  regions: { child },
  effects: {},
  transitions: { idle: {} },
});

// ✅ parent catches child errors
parent.on("error", (err) => {
  console.error("Child error bubbled up:", err);
});
```

**Anti-pattern — only subscribing to child errors:**

```ts
// ❌ child may not exist yet when parent is created
const child = new Actor({
  /* ... */
});
child.on("error", (err) => console.error(err));

const parent = new Actor({
  regions: { child }, // child replaced by parent's lifecycle
  // ...
});
// parent's regions own the child — subscribe to parent instead

// ✅ subscribe to parent to catch all child errors
parent.on("error", (err) => console.error(err));
```

### Any Handler

Use `Any` to intercept events across all states — useful for universal error handling, cleanup, or logging.

```ts
import { Any } from "@mantaq/core";

transitions: {
  Any: {
    // CANCEL works from any state
    CANCEL: (_event, { context }) => {
      context.cancelled = true;
      return { state: cancelledState };
    },
    // LOG every state change
    STATE_CHANGED: () => ({}), // no-op, but we could log
  },
  // State-specific handlers still run for their state
  idle: {
    START: () => ({ state: runningState }),
  },
}
```

**Anti-pattern — using `Any` for everything:**

```ts
// ❌ state-specific logic in Any defeats the purpose
Any: {
  SUBMIT_BASIC_INFO: (event, { context }) => {
    context.basicInfo = event; // wrong — only makes sense in basicInfo state
    return { state: shippingAddressState };
  },
}

// ✅ keep state-specific logic in state handlers
basicInfo: {
  SUBMIT_BASIC_INFO: (event, { context }) => {
    context.basicInfo = event;
    return { state: shippingAddressState };
  },
}
```

## Development

```bash
vp install
vp test
vp pack
```

## License

MIT
