# `@mantaq/examples`

A suite of runnable actor-model examples that demonstrate Mantaq's core
idioms, `state()`, `event()`, context mutation, effects, timers, regions, and
recovery, by reimplementing familiar state-machine patterns (multi-step forms,
async workflows, auth sessions, caches, undo/redo, event sourcing, and more) in
Mantaq.

Every file is a self-contained `*.test.ts`. Each one both **demonstrates**
an idiom and **proves** it: the assertions in the file are part of the suite, so
the example doubles as a test. Run the package and the examples self-verify.

## Running

From this package directory:

```sh
pnpm test              # run every *.test.ts (vite-plus / vp test)
pnpm test checkout     # run a single file by name
```

The canonical, heavily-commented entry point is
[`checkout.test.ts`](./checkout.test.ts). Start there. The
top-level docs site also builds this file as its single running example, so a
change that breaks it breaks the docs build.

## What each example shows

Mantaq expresses familiar state-machine patterns with a small, type-safe
primitive set. The table maps each example to the Mantaq idioms it exercises.

| Pattern              | File                                 | Mantaq idioms                                                                           |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Multi-step forms     | `checkout.test.ts`                   | States → `state()`, context → mutable fields, effects → async work                      |
| Async workflows      | `credit-check-workflow.test.ts`      | `invoke:fromPromise` → effect + internal events, guards → conditionals                  |
| Animation & UI state | `animation-ui-state.test.ts`         | Parallel states → regions as child Actors, `after` → `clock.setTimeout`                 |
| Authentication       | `authentication.test.ts`             | `invoke:fromCallback` → effect with `clock.setInterval`, `assign` → context mutation    |
| Cache with TTL/LRU   | `cache-with-ttl-and-lru.test.ts`     | TTL → `clock.setTimeout`, LRU eviction → `context.accessOrder`, regions → cache tiers   |
| Undo/redo system     | `undo-redo-editor.test.ts`           | Command pattern, context snapshot/restore, checkpoint history traversal                 |
| Game character       | `game-character.test.ts`             | Guard conditions, context-tracked combat state, regions for movement, effects           |
| Network connection   | `network-connection-manager.test.ts` | Regions for health monitor, exponential backoff, guard conditions, reconnection         |
| WebSocket reconnect  | `websocket-connection.test.ts`       | Retry with exponential backoff, `onAny` handler for cross-state events, async effects   |
| Event sourcing       | `event-sourcing.test.ts`             | Event log in context, fold for state derivation, snapshot + rebuild pattern             |
| Request/response     | `request-response.test.ts`           | `ActorMap` of partners coordinated with `withTimeout` + `onOutput` from `@mantaq/sugar` |
| Saga orchestration   | `saga-orchestrator.test.ts`          | Long-running compensation flows as state effects with internal events                   |
| Actor map            | `actor-map.test.ts`                  | `ActorMap` spawning/tearing down child actors, collecting results via `onOutput`        |

These reimplement classic state-machine patterns so you can see the Mantaq
idioms side by side with the mental model you already have. Read the file
header comment in each example for the specific problem it solves and the
trade-offs it makes.
