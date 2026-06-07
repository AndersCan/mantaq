# @mantaq/core

TypeScript actor model for state machines. Two-queue architecture (external + internal), hierarchical states, parallel regions, effects with AbortSignal cleanup, and VirtualClock for deterministic testing.

## Install

```bash
npm install @mantaq/core
```

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

## Core Concepts

### States

```ts
import { state } from "@mantaq/core";

const idle = state("idle")(); // leaf
const loading = state("loading")<{ url: string }>(); // with payload type
const done = state("done")().final(); // terminal

// Hierarchical (single region)
const connected = state("connected").region({
  initial: "auth",
  states: { auth: state("auth")(), active: state("active")() },
});

// Parallel (multiple regions)
const player = state("player").regions({
  playback: { initial: "paused", states: { paused, playing } },
  audio: { initial: "unmuted", states: { unmuted, muted } },
});
```

### Events

```ts
import { event } from "@mantaq/core";

const toggle = event("TOGGLE")();
const setData = event("SET_DATA")<{ value: string }>();

// Create payload
const evt = setData.create({ value: "hello" }); // { id: "SET_DATA", value: "hello" }
```

### Transitions

```ts
const actor = new Actor({
  inputs: [toggle, setData],
  states: [idle, active],
  initial: idle,
  transitions: {
    // State-specific handler
    idle: {
      TOGGLE: (evt, { context }) => {
        context.count++;
        return { state: active };
      },
    },
    // Any-state handler (checked first)
    Any: {
      RESET: () => ({ state: idle }),
    },
  },
});
```

Transition return: `{ state?, emit? }`. Omit context to leave it unchanged. Return `{}` for no-op.

### Context

Single typed record. Survives transitions. Mutate directly in handlers:

```ts
type Ctx = { count: number; items: string[] };

const actor = new Actor({
  context: { count: 0, items: [] } as Ctx,
  // ...
  transitions: {
    idle: {
      ADD: (event, { context }) => {
        context.items.push(event.item);
        return {}; // context unchanged, stay in state
      },
    },
  },
});
```

### Effects

Run on state entry, abort on exit via AbortSignal:

```ts
const actor = new Actor({
  effects: {
    loading: [
      ({ signal, clock, emit }) => {
        clock.setTimeout(1000, () => {
          if (!signal.aborted) {
            emit({ id: "DATA_LOADED", data: result });
          }
        });
      },
    ],
  },
});
```

### VirtualClock

Deterministic time control for tests:

```ts
import { VirtualClock } from "@mantaq/core";

const clock = new VirtualClock();
const actor = new Actor({ clock /* ... */ });

clock.advance(1000); // triggers all timers up to 1000ms
```

### Snapshots

```ts
actor.snapshot(); // { path: ["active"], regions: {} }
actor.subscribe((snap) => {
  /* on every change */
});
actor.settled(); // Promise<void> — resolves when queues empty
```

### Utilities

```ts
import { isIn, activeLeaves } from "@mantaq/core";

isIn(actor.snapshot(), "active"); // true if in state or descendant
activeLeaves(actor.snapshot()); // ["player.playback.playing", "player.audio.muted"]
```

## Examples

See `packages/examples/` for complete working examples:

- `checkout.actor.test.ts` — Multi-step form with back navigation
- `creditCheckWorkflow.actor.test.ts` — Async saga with retry/compensation
- `animationUiState.actor.test.ts` — Parallel regions (UI dimensions)
- `authentication.actor.test.ts` — Auth flow with effects
- `sagaOrchestrator.actor.test.ts` — Distributed transaction saga pattern

## Two-Queue Architecture

External events (actor.send) and internal events (self.send, effect emissions) use separate queues. Internal queue drains fully before next external event. Causal chains stay contiguous — no interleaving.

```
External queue:  [START, CANCEL, ...]
Internal queue:  [INVENTORY_RESERVED, PAYMENT_DONE, ...]
```

## Design Decisions

See `plan.md` for full rationale on design choices, including why serialization, history, and cross-actor addressing are not in core.
