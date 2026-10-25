# @mantaq/atlas

Turns a Mantaq machine into a versioned, deterministic JSON document, and ships three tools around it:

1. **Viewer**: static page that draws the document (dagre + SVG). No live actors.
2. **Fuzzer**: seeded, coverage-guided. Finds edges probing cannot see, and writes coverage back.
3. **AST annotator**: reads handler source (TypeScript compiler API), explains each edge.

Rule throughout: the runtime graph is the source of truth. The AST only annotates edges, the fuzzer only adds edges it observed, and anything not understood is reported as unknown / not analyzed, never guessed.

## Run it

```sh
vp run atlas:export     # checkout, auth, saga, credit -> packages/atlas/public/atlas/*.json
cd packages/atlas && vp dev   # viewer; loads atlas/examples.json, or ?src=<url>, or a picked file
vp run atlas:compare    # blind vs guided fuzzing report (Markdown, 30 seeds)
```

`export` options: `[outDir] --iterations N --no-fuzz --no-ast`. Seed: `MANTAQ_SEED` (default from `@mantaq/pbt`). Same seed → byte-identical files.

## Library

```ts
import {
  annotateMachine,
  fuzz,
  fuzzedMachine,
  guidance,
  serializeAtlas,
  toAtlasMachine,
} from "@mantaq/atlas";

const structure = annotateMachine(toAtlasMachine({ id: "cart", actor: createCart() }), {
  file: "/abs/path/cart.ts", // file with the m.on / m.onAny calls
  root: "/abs/repo", // locations are relative to this
});
const target = {
  id: "cart",
  create: () => {
    const clock = VirtualClock();
    return { actor: createCart(clock), clock };
  },
  payloads: { addItem: [{ sku: "A1", qty: 1 }] }, // sample payloads: the only shape knowledge
};
const result = fuzz(target, { seed: 1, iterations: 2000, ...guidance(structure) });
const machine = annotateMachine(fuzzedMachine(target, result), {
  file: "/abs/path/cart.ts",
  root: "/abs/repo",
});
serializeAtlas({ schemaVersion: 4, machines: [withTestCoverage(target, machine, mySequences)] });
```

Pass a **fresh** actor to `toAtlas` / `toAtlasMachine`. Probing calls handlers, and a handler that reads live actor state sees whatever state that actor is in.

`parseAtlas(text)` / `validateAtlas(value)` read untrusted JSON and return `Either<AtlasIssue[], AtlasDocument>`, with every issue and its path.

## Schema (v4)

`AtlasDocument { schemaVersion: 4, machines: AtlasMachine[] }`, keys sorted, two-space indent. Types in `src/schema.ts`.

| field              | meaning                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine.states[]` | `id` (region-prefixed `region.state`), `region`, `initial`, `final`, `coverage` (`null` = no run, else `{ hits }`)                                                                                                                                            |
| `machine.events[]` | `id`, `internal`, `payloadType` (always `null`: erased at runtime)                                                                                                                                                                                            |
| `edge.kind`        | `initial` · `transition` · `effect` (state runs effects on entry) · `stay` (handled, no state change)                                                                                                                                                         |
| `edge.to`          | `null` = **undetermined**: probing could not tell the target                                                                                                                                                                                                  |
| `edge.origin`      | `probe` (synthetic traversal) · `fuzz` (observed only while fuzzing)                                                                                                                                                                                          |
| `edge.explanation` | `null` (no handler: initial/effect, or AST not run) · `{ status: "analyzed", location, registration, branches, payloadReads, contextReads, contextWrites, readsActorState, comparisons, literals }` · `{ status: "not_analyzed", location, reason, snippet }` |
| `machine.fuzz`     | `null` or `{ seed, iterations, corpus: [{ steps, discovered }], errors: [{ from, event, message, steps }] }`; every sequence is shrunk and replayable from a fresh actor                                                                                      |

Bump `ATLAS_SCHEMA_VERSION` on any breaking change. The validator accepts only the current version.

## Coverage: two sources, two questions

The viewer's "Coverage from" picker dims elements with zero hits. What dimmed means depends on the source:

- **example tests** (`tested`): no test exercises this. It is the classic "what is untested" view, and the default when tests are supplied. The export replays the example tests transcribed in `handWrittenBaselines()`.
- **fuzz runs** (`coverage`): no fuzz run produced this. Fuzzing reaches almost everything, so little is dimmed. What does stay dimmed is usually a **probe-only edge**: probing ran the handler with `{}` and a sample context and predicted a target the live machine may never reach. Saga's `X -CANCEL-> failed` after inventory is reserved is an example. The edge panel calls these out. Fuzzing is not proof, so check the handler.

## How each tool works

**Probe** (`toAtlas`, Phase 1): `@mantaq/traversal` calls each handler with payload `{}` and a sample context. Fast, total, shallow.

**Fuzzer** (`fuzz`, Phase 3): a fresh actor and `VirtualClock` per run, so it is synchronous and deterministic. Mutations: insert, delete, swap, payload leaf tweak, time advance. A run is kept when it reaches a new feature (`state:x`, `edge:a>e>b`, `stay:a>e`, `error:a>e`), then shrunk to 1-minimal. Internal events are injected only when the current state handles them, as a live effect would (core rejects the rest). Payloads come from the per-machine samples and are mutated leaf by leaf, keeping each leaf's JSON type and never dropping keys. So a handler that throws is a real finding, not a type violation the compiler would reject.

**AST** (`annotateMachine`, Phase 4): one `ts.Program` per source file with the project tsconfig. It finds `m.on(state, { eventRef, handler })` / `m.onAny({ eventRef, handler })` and resolves names from the literal types of `state.name` / `eventRef.type`. It walks inline handlers: if/else, early returns, ternaries, and a ternary inside `state:`. A specific `on` wins over `onAny`, as at runtime.

**Guidance** (`guidance`, Phase 5): literal seeding plus a branch-distance guide built from AST comparisons. It only helps when handlers compare payload fields against literals far from the samples. See `docs/atlas/phase5-comparison.md`.

## What it cannot show

- **Payload-dependent branches** are invisible to probing: only the branch `{}` takes shows up, with no marker. The fuzzer finds them only if sample payloads can be mutated into them. The AST lists them as "not in graph" either way.
- **Handlers reading live actor state** (`actor.state.name`) come out `to: null` from probing. The fuzzer fills in the concrete targets it reached; the AST flags `readsActorState`.
- **Payload types** are erased: `payloadType` is always `null`, and the fuzzer knows only the shapes you sample.
- **Effects** are opaque. An effect edge says "this state runs effects on entry", not what they emit or which effect it is (traversal labels it by state, not effect name). Example fixtures stub effects, and the fuzzer stands in for them by injecting internal events. It can therefore produce event orders a real effect never would, but only in states that handle the event.
- **Regions**: the fuzzer observes the root actor only. Region transitions are probed but not fuzzed.
- **AST limits**: handlers passed by reference, returns inside `switch` / loops / `try`, and computed `eventRef`s are `not_analyzed`, with a reason and snippet. Comparisons against actor state or computed values carry no guidance.
- **History** cannot distinguish an ignored event from a self-loop. The fuzzer can (`stay` vs `transition`), but probe-only coverage cannot.
- **Fuzzing is not proof.** An edge that is absent was not reached; it is not shown to be impossible.

## Fixtures

`src/fixtures/{checkout,auth,saga}.ts` copy the handlers of `packages/examples/*.test.ts` verbatim, with effects stubbed. The examples live in test files and cannot be imported, so the copies can drift from them. `credit.ts` (conditional handlers, far literals) and `switchy.ts` (unsupported control flow) exist for the AST and guidance tests.
