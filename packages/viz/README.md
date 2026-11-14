# @mantaq/viz

Draws a Mantaq machine in the browser and lets you walk it. Input is a viz document: versioned, deterministic JSON. `@mantaq/inspect` makes one from your machine; this package only reads it, and runs nothing.

- `@mantaq/viz`: the document. Types, `parseViz` / `validateViz` (untrusted JSON → `Either<VizIssue[], VizDocument>`, every issue with its path), `serializeViz`, and the walk (`movesFrom`, `decodePath`, …). No DOM.
- `@mantaq/viz/viewer`: `mountViewer(root, document)` / `mountVizText(root, { source, text })` to embed it in a page, plus `@mantaq/viz/viewer.css`.

Most apps never import this package directly: add the [`@mantaq/inspect`](https://www.npmjs.com/package/@mantaq/inspect) Vite plugin and open `/__mantaq/` on your dev server (`npx vite` or `npm run dev`).

## Embed the viewer

```sh
npm install @mantaq/viz
```

```ts
import { mountVizText } from "@mantaq/viz/viewer";
import "@mantaq/viz/viewer.css";

const root = document.getElementById("viz");
if (root) {
  const text = await (await fetch("/viz.json")).text(); // a document from @mantaq/inspect
  mountVizText(root, { source: "/viz.json", text });
}
```

`mountVizText` validates the JSON and lists every issue in place of the diagram when it is not a current viz document. `mountViewer(root, document)` takes an already-parsed document.

## Walking the graph

What each mark means and how to walk it: [How the visualizer works](https://anderscan.github.io/mantaq/guides/visualizer/). Without a `driver` the walk follows declarations, so guards are not evaluated (`movesFrom`, `unhandledSends`, `decodePath` in `src/moves.ts`).

**Live** (`mountViewer(root, doc, { driver })`, or the `@mantaq/inspect` Vite page): steps run the real actor through `createDriver` from `@mantaq/inspect/drive`. Effects are held, except the initial state's, which core runs while the actor is built. `VizLiveState` carries what the panel shows: `effectMode`, `waiting`, `payload`, `context`, `timers` and `after` (results an effect sends back later, offered through the driver's optional `listen(onChange)`).

## Schema

`VizDocument { schemaVersion, machines: VizMachine[] }`, where `schemaVersion` is `VIZ_SCHEMA_VERSION` from `src/schema.ts`; keys sorted, two-space indent. Types in `src/schema.ts`.

| field                 | meaning                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine.states[]`    | `id` (region-prefixed `region.state`), `region`, `initial`, `final`, `effects` (`[{ name, sends }]` run on entry, registration order; `sends`: declared event ids, `null` = not declared), `coverage` (`null` = no run, else `{ hits }`), `doc` (leading JSDoc of the `state(...)` declaration, `null` = undocumented or AST not run) |
| `edge.from`           | a state id, `__initial__`, or `*` (`region.*` in a region): an `onAny` registration, meaning any non-final state. `*` is never in `states`; a `stay` from `*` has `to: "*"`                                                                                                                                                           |
| `machine.context`     | fields of the context type (same shape as `events[].payload`); `null` = not an object type or not analyzed                                                                                                                                                                                                                            |
| `machine.outputs`     | declared output event ids, sorted; empty = none                                                                                                                                                                                                                                                                                       |
| `machine.partOutputs` | declared output event ids of each region (by path) and actor map child (by map name), each sorted; parts with none are left out. `systemOf(machine)` joins them to the parts that handle them                                                                                                                                         |
| `machine.events[]`    | `id`, `internal`, `payload` (fields of the payload type: `name`, `type`, `optional`, `doc`, `input`, `choices`, `sample`; `null` = none or not analyzed), `doc` (leading JSDoc of the `event(...)` declaration, `null` = none)                                                                                                        |
| `edge.kind`           | `initial` · `transition` · `effect` (state runs effects on entry) · `stay` (handled, no state change: a registration without `to`, or observed while fuzzing)                                                                                                                                                                         |
| `edge.to`             | `null` = **undetermined**: only for actors that carry no `to` declarations                                                                                                                                                                                                                                                            |
| `edge.origin`         | `declared` (builder `to`, vouched for by the type checker) · `probe` (synthetic traversal, undeclared actors) · `fuzz` (observed only while fuzzing)                                                                                                                                                                                  |
| `edge.explanation`    | `null` (no handler: initial/effect, or AST not run) · `{ status: "analyzed", location, registration, branches, payloadReads, contextReads, contextWrites, readsActorState, comparisons, literals }` · `{ status: "not_analyzed", location, reason, snippet }`                                                                         |
| `edge.doc`            | leading JSDoc of the `m.on` / `m.onAny` call behind the edge, or of the `m.effect` calls of the state for an `effect` edge (joined in order); `null` = undocumented, no handler, or AST not run                                                                                                                                       |
| `machine.runs[]`      | named example runs, replayable on the live page: `{ name, steps }`, each step an event (`{ kind: "event", event, payload }`) or a clock advance (`{ kind: "advance", ms }`). Empty = none supplied                                                                                                                                    |
| `machine.fuzz`        | `null` or `{ seed, iterations, corpus: [{ steps, discovered }], errors: [{ from, event, message, steps }], failedExpectations, expectations: [{ kind, state, match, held }] }`; every sequence is shrunk and replayable from a fresh actor                                                                                            |

Bump `VIZ_SCHEMA_VERSION` on any breaking change. The validator accepts only the current version.

## Coverage

The **Coverage from** picker dims what no run reached. What each source means: the [`@mantaq/inspect` README](../inspect/README.md#coverage-two-sources-two-questions).
