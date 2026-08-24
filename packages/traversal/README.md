# @mantaq/traversal

Graph extraction, traversal algorithms, and runtime coverage tracking for
[@mantaq/core](https://www.npmjs.com/package/@mantaq/core) actors.

Use it to:

- **Inspect** a state machine statically — turn an actor into a
  `nodes`/`edges` graph of its states and transitions.
- **Reason** about that graph — which states are reachable, what paths exist
  between two states, and whether any declared transition can never fire.
- **Verify** coverage at runtime — wrap an actor so every visited state,
  fired transition, and executed effect is recorded as it runs.

All three pieces work on the same `ActorGraph` shape, so you can build the
graph once and walk it however your check needs.

## Install

```sh
npm install @mantaq/traversal
```

> `@mantaq/traversal` depends on `@mantaq/core` and `@mantaq/utils`, which are
> resolved as workspace packages in this repo.

## Building the graph

`buildGraph` walks an actor (and any nested regions) and returns an
`ActorGraph`:

```ts
import { buildGraph } from "@mantaq/traversal";
import { createActor } from "@mantaq/core";

const actor = createActor(myMachine);
const graph = buildGraph(actor);
// graph.nodes: GraphNode[]   — one per declared state (+ an `__initial__` node)
// graph.edges: GraphEdge[]   — one per (state, event) handler
```

Each `GraphNode` carries `id`, `label`, `isActive`, `isFinal`, and
`isInitial`. Each `GraphEdge` carries `source`, `target`, `label` (the event
that triggers it), `isActive`, `isInternal`, and `isUndetermined`.

An edge is **undetermined** when its handler runs but does not declare a target
state for the sampled context (e.g. a guard that resolves only at runtime). The
graph is a _static_ approximation: it invokes each handler with a sample
context to discover the transitions it _could_ take, so it documents intent
and reachability, not live execution.

### Sampling contexts

Handlers may branch on context. Pass one or more named sample contexts to see
how the graph differs per context shape:

```ts
const graph = buildGraph(actor, {
  sampleContexts: {
    guest: { loggedIn: false },
    member: { loggedIn: true },
  },
});
```

Each context name is recorded on the relevant edges (`edge.contexts`), so you
can tell which branches belong to which context. With a single context, use
`sampleContext` instead.

### Constants

- `INITIAL_NODE_ID` — the synthetic id of the graph's entry node (the edge
  from it points to the actor's initial state).

## Walking the graph

The algorithms module operates on an `ActorGraph` and is pure — no actor
needed:

```ts
import { reachable, allPaths, findCycles, unreachableNodes, shortestPath } from "@mantaq/traversal";
```

| Function                            | Returns            | Use                                                 |
| ----------------------------------- | ------------------ | --------------------------------------------------- |
| `reachable(graph, fromId, toId)`    | `boolean`          | Is `toId` reachable from `fromId`?                  |
| `allPaths(graph, fromId, toId)`     | `string[][]`       | Every distinct path of node ids between two states. |
| `findCycles(graph)`                 | `string[][]`       | Every cycle in the graph, as node-id loops.         |
| `unreachableNodes(graph, fromId)`   | `string[]`         | Nodes no walk from `fromId` can ever reach.         |
| `shortestPath(graph, fromId, toId)` | `string[] \| null` | The fewest-edge path, or `null` if unreachable.     |

A common check is "every declared state is reachable from the initial state":

```ts
import { INITIAL_NODE_ID, unreachableNodes } from "@mantaq/traversal";

const dead = unreachableNodes(graph, INITIAL_NODE_ID);
if (dead.length > 0) {
  throw new Error(`Unreachable states: ${dead.join(", ")}`);
}
```

## Tracking coverage at runtime

`instrument` wraps an actor so it records everything it does into a `History`.
The wrapped actor has the same surface as the original (`send`, `on`,
`snapshot`, `context`, `regions`, `inject`, `dispose`, `recover`, `settled`)
plus a `history` property.

```ts
import { instrument } from "@mantaq/traversal";

const wrapped = instrument(actor);
wrapped.send({ type: "START" });

const history = wrapped.history;
history.visitedStates(); // Set<string>  — every state the actor entered
history.firedTransitions(); // Set<string>  — "from:event" for each fired transition
history.effects(); // EffectRecord[] — effects executed per state
history.transitions(); // TransitionRecord[] — full from/event/to log
history.sends(); // { event: string }[] — every event sent in
history.entries(); // HistoryEntry[] — the raw, ordered record
```

`History` records state visits, transitions, effects, and sends. Call
`history.reset()` to reuse a wrapper across independent runs.

Combine static and runtime views to assert coverage — e.g. that every
reachable state in the graph was actually visited by a scenario:

```ts
const graph = buildGraph(actor);
const wrapped = instrument(actor);
runScenario(wrapped); // exercise the actor

const graphStates = new Set(graph.nodes.map((n) => n.id));
const missed = [...wrapped.history.visitedStates()].filter((s) => !graphStates.has(s));
```

## Types

```ts
import type {
  ActorGraph,
  GraphNode,
  GraphEdge,
  StateVisit,
  TransitionRecord,
  EffectRecord,
  HistoryEntry,
} from "@mantaq/traversal";
```

`ActorGraph` is `{ nodes: GraphNode[]; edges: GraphEdge[] }`. See the package
source for the full field shapes.
