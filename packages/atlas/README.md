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
serializeAtlas({ schemaVersion: 5, machines: [withTestCoverage(target, machine, mySequences)] });
```

Pass a **fresh** actor to `toAtlas` / `toAtlasMachine`. Probing calls handlers, and a handler that reads live actor state sees whatever state that actor is in.

`parseAtlas(text)` / `validateAtlas(value)` read untrusted JSON and return `Either<AtlasIssue[], AtlasDocument>`, with every issue and its path.

## Schema (v5)

`AtlasDocument { schemaVersion: 5, machines: AtlasMachine[] }`, keys sorted, two-space indent. Types in `src/schema.ts`.

| field              | meaning                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machine.states[]` | `id` (region-prefixed `region.state`), `region`, `initial`, `final`, `coverage` (`null` = no run, else `{ hits }`)                                                                                                                                            |
| `edge.from`        | a state id, `__initial__`, or `*` (`region.*` in a region): an `onAny` registration, meaning any non-final state. `*` is never in `states`; a `stay` from `*` has `to: "*"`                                                                                   |
| `machine.events[]` | `id`, `internal`, `payloadType` (always `null`: erased at runtime)                                                                                                                                                                                            |
| `edge.kind`        | `initial` · `transition` · `effect` (state runs effects on entry) · `stay` (handled, no state change: a registration without `to`, or observed while fuzzing)                                                                                                 |
| `edge.to`          | `null` = **undetermined**: only for actors that carry no `to` declarations                                                                                                                                                                                    |
| `edge.origin`      | `declared` (builder `to`, vouched for by the type checker) · `probe` (synthetic traversal, undeclared actors) · `fuzz` (observed only while fuzzing)                                                                                                          |
| `edge.explanation` | `null` (no handler: initial/effect, or AST not run) · `{ status: "analyzed", location, registration, branches, payloadReads, contextReads, contextWrites, readsActorState, comparisons, literals }` · `{ status: "not_analyzed", location, reason, snippet }` |
| `machine.fuzz`     | `null` or `{ seed, iterations, corpus: [{ steps, discovered }], errors: [{ from, event, message, steps }] }`; every sequence is shrunk and replayable from a fresh actor                                                                                      |

Bump `ATLAS_SCHEMA_VERSION` on any breaking change. The validator accepts only the current version.

## Coverage: two sources, two questions

The viewer's "Coverage from" picker dims elements with zero hits. What dimmed means depends on the source:

- **example tests** (`tested`): no test exercises this. It is the classic "what is untested" view, and the default when tests are supplied. The export replays the example tests transcribed in `handWrittenBaselines()`.
- **fuzz runs** (`coverage`): no fuzz run produced this. Fuzzing reaches almost everything, so little is dimmed. What does stay dimmed is usually a **declared but unreached edge**: the handler lists the target in `to`, but its guards may never allow it. Saga's `compensatingRefund -REFUND_DONE-> failed` is an example. The edge panel calls these out. Fuzzing is not proof, so check the handler.

## How each tool works

**Structure** (`toAtlas`, Phase 1): states come from the actor's `states`, edges from each registration's `to` (`actor.options.targets`): one edge per declared target, a `stay` edge when `to` is absent. `onAny` registrations draw from one `*` source per machine or region, never once per state. Coverage of a `*` edge counts every covered state; a state's own handler for the same event is not told apart. Nothing runs to find them. `@mantaq/traversal` still calls each handler with payload `{}` and each sample context, but only to label edges with the contexts that reach them and what they emit.

**Fuzzer** (`fuzz`, Phase 3): a fresh actor and `VirtualClock` per run, so it is synchronous and deterministic. Mutations: insert, delete, swap, payload leaf tweak, time advance, and **loop**. Loop repeats, 2–13 times or a compared literal's count, a step that changed the actor's context, so counter guards like `if (attempts > 10)` become reachable. A step that changes nothing is never looped. A run is kept when it reaches a new feature (`state:x`, `edge:a>e>b`, `stay:a>e`, `error:a>e`), then shrunk to 1-minimal. Internal events are injected only when the current state handles them, as a live effect would (core rejects the rest). Payloads come from the per-machine samples and are mutated leaf by leaf, keeping each leaf's JSON type and never dropping keys. So a handler that throws is a real finding, not a type violation the compiler would reject.

**AST** (`annotateMachine`, Phase 4): one `ts.Program` per source file with the project tsconfig. It finds `m.on(state, { event, handler })` / `m.onAny({ event, handler })` and resolves names from the literal types of `state.name` / `event.type`. It walks inline handlers: if/else, early returns, ternaries, and a ternary inside `state:`. A specific `on` wins over `onAny`, as at runtime.

**Guidance** (`guidance`, Phase 5): literal seeding plus a branch-distance guide built from AST comparisons on payload and context. It helps when handlers compare payload fields against literals far from the samples, or count in context toward a threshold. See `docs/atlas/phase5-comparison.md`.

## What it cannot show

- **Guards** are not evaluated. A declared edge says "the handler may return this", not "some input reaches it". Fuzz coverage and the AST's branch conditions are the evidence; neither is proof.
- **`onAny` routing on live actor state** (`actor.state.name`) cannot be drawn exactly: the `*` edges say "from any state, may go to X", not which state leads where. Register per-state `m.on` handlers instead, as checkout's `back` does. `routingWarnings(machine)` lists these handlers (the viewer and `atlas:export` show them); it needs AST explanations.
- **Payload types** are erased: `payloadType` is always `null`, and the fuzzer knows only the shapes you sample.
- **Effects** are opaque. An effect edge says "this state runs effects on entry", not what they emit or which effect it is (traversal labels it by state, not effect name). Example fixtures stub effects, and the fuzzer stands in for them by injecting internal events. It can therefore produce event orders a real effect never would, but only in states that handle the event.
- **Regions**: the fuzzer observes the root actor only. Region transitions are probed but not fuzzed.
- **AST limits**: handlers passed by reference, returns inside `switch` / loops / `try`, and computed `event`s are `not_analyzed`, with a reason and snippet. Comparisons against actor state or computed values carry no guidance.
- **History** cannot distinguish an ignored event from a self-loop. The fuzzer can (`stay` vs `transition`), but probe-only coverage cannot.
- **Fuzzing is not proof.** An edge that is absent was not reached; it is not shown to be impossible.

## Fixtures

`src/fixtures/{checkout,auth,saga}.ts` copy the handlers of `packages/examples/*.test.ts` verbatim, with effects stubbed. The examples live in test files and cannot be imported, so the copies can drift from them. `credit.ts` (conditional handlers, far literals), `retry.ts` (context counter, `attempts > 10`) and `switchy.ts` (unsupported control flow) exist for the AST, loop and guidance tests.
