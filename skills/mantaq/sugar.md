# Sugar Reference

Ergonomic layer over `@mantaq/core`: `npm install @mantaq/sugar`.

This lists what exists and when to reach for it. Get exact signatures from
`node_modules/@mantaq/sugar/dist/*.d.ts` or the [example tests](https://github.com/AndersCan/mantaq/tree/main/packages/examples).

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
- Return actor maps from the factory next to the actor, `return { actor, photos }`, so the viz draws and drives the children, and fuzzing sends to the ones it started.
- Fuzzing sends to a child by the key a step started it with, so give the event that starts it a payload sample (`source` or `payloads`).
- Prefer sugar over raw core where it fits. Reach for the map, broadcast, tag and parts helpers when the need arises, not preemptively.

## Pool: machines that pass work

`createPool({ name, workers, run })` builds one inbox and `workers` workers (`w1`..`wn`) that pull items. The inbox hands items to free workers with `${name}.ITEMS_ASSIGNED`; a worker reports back with `${name}.ITEMS_FINISHED` or `${name}.ITEMS_FAILED`. The inbox is `allWorkersFree`, `workersBusy` or `workWaiting`. Return the pool's actor and its worker map from the factory so the viz draws and drives the workers. In the viewer, a step that moves another part names it on the Path (`[data-live-cascade]`): `team.ITEM_ARRIVED {item a}, then w1: free → working`. A machine whose parts send each other events opens on boxes and arrows; **Open** and **← System** move between that view and one part's diagram. To feed the pool from your own machine, declare `pool.events.ITEM_ARRIVED` as that machine's output, wire it with `onOutput(machine, (out) => pool.actor.send(out))`, and return all three from one factory, `{ actor: machine, orders: pool.actor, cooks: pool.workers }`: the diagram draws the arrow into the inbox, and steps to the inbox use `{ region: "orders" }`. Size the pool with `pool.resize(n)` or by sending `${name}.WORKERS_RESIZED { count }`. Return a `Pool` flat as above, never `{ actor, pool }`.
