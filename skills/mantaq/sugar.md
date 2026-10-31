# Sugar Reference

Ergonomic layer over `@mantaq/core`: `npm install @mantaq/sugar`. Written against `@mantaq/sugar` 1.0.

This lists what exists and when to reach for it. Get exact signatures from
`node_modules/@mantaq/sugar/dist/*.d.ts` or `packages/examples/`.

| Helper                                           | Use for                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `states(...)`, `events(...)`                     | Create many state/event refs in one call.                               |
| `matches(actor, "a.b")`                          | Is the actor in state `a`, region `b`? Dotted path through regions.     |
| `isIn(snapshot, name)`, `activeLeaves(snapshot)` | Any-depth state check; list of deepest active states.                   |
| `tag(...states)`                                 | Group states under one `has(snapshot)` check.                           |
| `withTimeout`                                    | Effect helper: emit one event after a delay on the injected clock.      |
| `withPromise`                                    | Effect helper: turn a promise into success/error events, abort-guarded. |
| `createActorMap`                                 | Spawn, send to and kill same-shaped child actors by key at runtime.     |
| `onOutput`                                       | Route a child actor's declared outputs to a handler (manual wiring).    |
| `broadcast`                                      | Send one event to every child of a map.                                 |
| `actorSpec`, `definePart`, `use`, `withParts`    | Split a large `setup` into typed, reusable fragments.                   |

## Notes

- Return the promise from an effect that uses `withPromise` so `settled()` waits for it.
- `regions` wire child outputs into the parent automatically. `createActorMap` children do not: connect them with `onOutput`.
- Map children's context must be plain data. Capture parent actors in the factory closure, not in context.
- Dispose an actor map when its owner is disposed.
- Prefer sugar over raw core where it fits. Reach for the map, broadcast, tag and parts helpers when the need arises, not preemptively.
