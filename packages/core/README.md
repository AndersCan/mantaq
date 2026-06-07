# @mantaq/core

State machine library. Small API surface — cook the primitives, not the framework.

## Install

```bash
vp install
```

## Usage

```ts
import { Actor, state, event } from "@mantaq/core";
```

## Patterns

### Typed Actor Context

TypeScript infers `ActorContext` from the `context` option. Pass the object directly — no `as` needed.

```ts
interface AuthContext {
  user?: User;
  phoneNumber?: string;
}

const actor = new Actor({
  // ...
  context: {} as AuthContext,
  // or: context: { user: undefined } as AuthContext,
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

If you need the type, cast the entire `Actor` constructor options object once:

```ts
const opts = {
  inputs: [signInEvent],
  states: [idleState, signingInState],
  initial: idleState,
  context: {} as AuthContext,
  transitions: {
    /* ... */
  },
} as const;

const actor = new Actor(opts);
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

**Anti-pattern — untyped events:**

```ts
// ❌ payload is `unknown`, handlers must cast
const signInEvent = event("SIGN_IN")<{ phoneNumber: string }>();
// Actually this is fine — the issue is when you skip the generic:
const badEvent = event("SIGN_IN")(); // payload = unknown, no type safety
```

**Anti-pattern — sending raw objects instead of using `.create()`:**

```ts
// ✅ typed
actor.send(signInEvent.create({ phoneNumber: "+1234567890" }));

// ❌ bypasses type checking
actor.send({ id: "SIGN_IN", phoneNumber: "+1234567890" });
```

### Two-Queue Architecture

Mantaq uses two event queues: **external** (user-sent) and **internal** (effect-emitted). Understanding the difference prevents subtle bugs.

**External events** are sent via `actor.send()` — they trigger transitions on the current state.

**Internal events** are emitted from effects via `emit()` — they queue up and process after the current transition completes.

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

**Ordering guarantee:** Internal events from `emit()` within a transition handler are processed immediately after that transition (depth-first). Events emitted from effects run after the effect completes.

**Anti-pattern — mixing internal/external incorrectly:**

```ts
// ❌ declaring a user-sent event as internal
internal: [connectEvent], // user can't send internal events via actor.send()

// ✅ keep external events in inputs
inputs: [connectEvent],
```

### Effect Pattern

Effects run when entering a state. They receive typed context and emit internal events.

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
  snapshot: Snapshot;
  context: unknown; // you must serialize context separately
}

function saveActor(actor: Actor<any, any, any, any, any, any, any>): SerializedActor {
  return {
    snapshot: actor.snapshot(),
    // Context is not serializable by default — extract what you need
    context: { ...actor.context },
  };
}

function loadActor(
  data: SerializedActor,
  factory: (ctx: unknown) => Actor<any, any, any, any, any, any, any>,
): Actor<any, any, any, any, any, any, any> {
  return factory(data.context);
}

// Usage
const saved = saveActor(actor);
localStorage.setItem("actor", JSON.stringify(saved));

const raw = localStorage.getItem("actor");
if (raw) {
  const data = JSON.parse(raw);
  const restored = loadActor(data, (ctx) => createMyActor(ctx));
  // restored.state.name === data.snapshot.path[0]
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

Errors in effects are caught and forwarded to `"error"` subscribers. Never throw from transition handlers.

```ts
actor.on("error", (err) => {
  console.error("Effect error:", err);
});

effects: {
  working: [
    ({ emit, clock }) => {
      clock.setTimeout(100, () => {
        try {
          const result = riskyOperation();
          emit(doneEvent.create({ result }));
        } catch (err) {
          // ✅ emit error as internal event instead of throwing
          emit(failedEvent.create({ error: String(err) }));
        }
      });
    },
  ],
}
```

**Anti-pattern — throwing in transition handlers:**

```ts
transitions: {
  idle: {
    PROCESS: (event, { context }) => {
      // ❌ throw breaks the state machine
      if (!event.data) throw new Error("missing data");
      return { state: doneState };
    },
  },
}

// ✅ handle errors by transitioning to error state
transitions: {
  idle: {
    PROCESS: (event, { context }) => {
      if (!event.data) {
        context.error = "missing data";
        return { state: errorState };
      }
      return { state: doneState };
    },
  },
}
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
