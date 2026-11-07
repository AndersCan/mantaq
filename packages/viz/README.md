# @mantaq/viz

Draws a Mantaq machine in the browser and lets you walk it. Input is a viz document: versioned, deterministic JSON. `@mantaq/inspect` makes one from your machine; this package only reads it, and runs nothing.

- `@mantaq/viz`: the document. Types, `parseViz` / `validateViz` (untrusted JSON → `Either<VizIssue[], VizDocument>`, every issue with its path), `serializeViz`, and the walk (`movesFrom`, `decodePath`, …). No DOM.
- `@mantaq/viz/viewer`: `mountViewer(root, document)` / `mountVizText(root, { source, text })` to embed it in a page, plus `@mantaq/viz/viewer.css`.
- `@mantaq/viz/standalone`, `@mantaq/viz/live`: whole-page entries used by the Vite plugin (live page).

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

The viewer keeps a cursor on one state, starting at the initial one. The panel lists what can happen next, in three groups:

- **Send an input**: edges on input events.
- **Effect reports back**: internal events that an effect of the current state declares in `sends` (`m.effect(state, { name, sends: [...], fn })`). Entering `submitting` runs `chargeCard`, which sends `paymentOk | paymentFail | paymentTimeout`.
- **Other internal events**: internal events that no effect of the state declares.

Take a step with a panel button, by clicking a pulsing edge, or by clicking a state that exactly one next step reaches. An undetermined edge (`to: null`) offers each target its AST explanation names. Without one, it cannot be taken. A final state ends the walk. **Back** (or ←), **Reset** and the path list undo steps. The standalone page keeps the walk in the URL: `?step=` holds one edge id per step, plus `~target` for an undetermined edge. `?machine=<id>&run=<name>` opens a recorded run by name; use it for links in docs and issues.

**Static walk** (standalone page): nothing runs. The walk follows declarations, so guards are not evaluated, and a path may not happen at runtime. The logic is in `src/moves.ts`: `movesFrom`, `unhandledSends`, `decodePath`.

**Live** (the Vite plugin page, or `mountViewer(root, doc, { driver })`): steps run the real actor through `createDriver` from `@mantaq/inspect/drive`, so guards are evaluated. The panel opens with a note on what runs. An event that declares payload fields (`events[].payload`) asks for them before it is sent, from the Send list or a click on its edge, in a popover on the diagram next to that edge (Escape closes it): one input per field, already filled with a valid value, a dropdown for a fixed set of values, a number box for numbers and a text box for text; an empty optional field is left out. An event whose payload type could not be read, but that fuzzing sent a payload with, shows one JSON box filled with the first fuzz sample, the other samples one click away. Other events send at once, or open the JSON box via **with payload**. The Context tab lists the machine's declared context fields (`context`) with their type, meaning (the field's doc comment) and current value, marking those the last step changed. Context cannot be typed in. Without declared fields it shows the JSON. Timers advance by button, and **Back** replays the path from a fresh actor.

## Schema (v12)

`VizDocument { schemaVersion: 12, machines: VizMachine[] }`, keys sorted, two-space indent. Types in `src/schema.ts`.

| field              | meaning                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine.states[]` | `id` (region-prefixed `region.state`), `region`, `initial`, `final`, `effects` (`[{ name, sends }]` run on entry, registration order; `sends`: declared event ids, `null` = not declared), `coverage` (`null` = no run, else `{ hits }`), `doc` (leading JSDoc of the `state(...)` declaration, `null` = undocumented or AST not run) |
| `edge.from`        | a state id, `__initial__`, or `*` (`region.*` in a region): an `onAny` registration, meaning any non-final state. `*` is never in `states`; a `stay` from `*` has `to: "*"`                                                                                                                                                           |
| `machine.context`  | fields of the context type (same shape as `events[].payload`); `null` = not an object type or not analyzed                                                                                                                                                                                                                            |
| `machine.outputs`  | declared output event ids, sorted; empty = none                                                                                                                                                                                                                                                                                       |
| `machine.events[]` | `id`, `internal`, `payload` (fields of the payload type: `name`, `type`, `optional`, `doc`, `input`, `choices`, `sample`; `null` = none or not analyzed), `doc` (leading JSDoc of the `event(...)` declaration, `null` = none)                                                                                                        |
| `edge.kind`        | `initial` · `transition` · `effect` (state runs effects on entry) · `stay` (handled, no state change: a registration without `to`, or observed while fuzzing)                                                                                                                                                                         |
| `edge.to`          | `null` = **undetermined**: only for actors that carry no `to` declarations                                                                                                                                                                                                                                                            |
| `edge.origin`      | `declared` (builder `to`, vouched for by the type checker) · `probe` (synthetic traversal, undeclared actors) · `fuzz` (observed only while fuzzing)                                                                                                                                                                                  |
| `edge.explanation` | `null` (no handler: initial/effect, or AST not run) · `{ status: "analyzed", location, registration, branches, payloadReads, contextReads, contextWrites, readsActorState, comparisons, literals }` · `{ status: "not_analyzed", location, reason, snippet }`                                                                         |
| `edge.doc`         | leading JSDoc of the `m.on` / `m.onAny` call behind the edge, or of the `m.effect` calls of the state for an `effect` edge (joined in order); `null` = undocumented, no handler, or AST not run                                                                                                                                       |
| `machine.runs[]`   | named example runs, replayable on the live page: `{ name, steps }`, each step an event (`{ kind: "event", event, payload }`) or a clock advance (`{ kind: "advance", ms }`). Empty = none supplied                                                                                                                                    |
| `machine.fuzz`     | `null` or `{ seed, iterations, corpus: [{ steps, discovered }], errors: [{ from, event, message, steps }] }`; every sequence is shrunk and replayable from a fresh actor                                                                                                                                                              |

Bump `VIZ_SCHEMA_VERSION` on any breaking change. The validator accepts only the current version.

## Schema (v12)

`VizDocument { schemaVersion: 12, machines: VizMachine[] }`, keys sorted, two-space indent. Types in `src/schema.ts`.

| field              | meaning                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine.states[]` | `id` (region-prefixed `region.state`), `region`, `initial`, `final`, `effects` (`[{ name, sends }]` run on entry, registration order; `sends`: declared event ids, `null` = not declared), `coverage` (`null` = no run, else `{ hits }`), `doc` (leading JSDoc of the `state(...)` declaration, `null` = undocumented or AST not run) |
| `edge.from`        | a state id, `__initial__`, or `*` (`region.*` in a region): an `onAny` registration, meaning any non-final state. `*` is never in `states`; a `stay` from `*` has `to: "*"`                                                                                                                                                           |
| `machine.context`  | fields of the context type (same shape as `events[].payload`); `null` = not an object type or not analyzed                                                                                                                                                                                                                            |
| `machine.outputs`  | declared output event ids, sorted; empty = none                                                                                                                                                                                                                                                                                       |
| `machine.events[]` | `id`, `internal`, `payload` (fields of the payload type: `name`, `type`, `optional`, `doc`, `input`, `choices`, `sample`; `null` = none or not analyzed), `doc` (leading JSDoc of the `event(...)` declaration, `null` = none)                                                                                                        |
| `edge.kind`        | `initial` · `transition` · `effect` (state runs effects on entry) · `stay` (handled, no state change: a registration without `to`, or observed while fuzzing)                                                                                                                                                                         |
| `edge.to`          | `null` = **undetermined**: only for actors that carry no `to` declarations                                                                                                                                                                                                                                                            |
| `edge.origin`      | `declared` (builder `to`, vouched for by the type checker) · `probe` (synthetic traversal, undeclared actors) · `fuzz` (observed only while fuzzing)                                                                                                                                                                                  |
| `edge.explanation` | `null` (no handler: initial/effect, or AST not run) · `{ status: "analyzed", location, registration, branches, payloadReads, contextReads, contextWrites, readsActorState, comparisons, literals }` · `{ status: "not_analyzed", location, reason, snippet }`                                                                         |
| `edge.doc`         | leading JSDoc of the `m.on` / `m.onAny` call behind the edge, or of the `m.effect` calls of the state for an `effect` edge (joined in order); `null` = undocumented, no handler, or AST not run                                                                                                                                       |
| `machine.runs[]`   | named example runs, replayable on the live page: `{ name, steps }`, each step an event (`{ kind: "event", event, payload }`) or a clock advance (`{ kind: "advance", ms }`). Empty = none supplied                                                                                                                                    |
| `machine.fuzz`     | `null` or `{ seed, iterations, corpus: [{ steps, discovered }], errors: [{ from, event, message, steps }] }`; every sequence is shrunk and replayable from a fresh actor                                                                                                                                                              |

Bump `VIZ_SCHEMA_VERSION` on any breaking change. The validator accepts only the current version.

## Coverage: two sources, two questions

The viewer's "Coverage from" picker dims elements with zero hits. What dimmed means depends on the source:

- **examples + fuzz** (`reached`): neither an example nor fuzzing reached this. The default when both sources are present, and the same merge `expectReached` uses. Fix a miss by adding an example to `tests`.
- **example tests** (`tested`): no test exercises this. It is the classic "what is untested" view. Supply the event sequences your tests send (`inspect({ tests })`).
- **fuzz runs** (`coverage`): no fuzz run produced this. Fuzzing reaches almost everything, so little is dimmed. What does stay dimmed is usually a **declared but unreached edge**: the handler lists the target in `to`, but its guards may never allow it. Saga's `compensatingRefund -REFUND_DONE-> failed` is an example. The edge panel calls these out. Fuzzing is not proof, so check the handler.

## Contributing (repo only)

Dev page with the bundled examples, from the [mantaq repo](https://github.com/AndersCan/mantaq): `vp run viz:export`, then `vp dev` in `packages/viz`. It loads `examples/examples.json`, `?src=<url>`, or a picked file.
