# @mantaq/inspect

Turns your Mantaq machine into a picture you can walk: add the Vite plugin, no other config.

It finds every exported actor, or function that builds one, from the file's types. It reads handler explanations and sample payloads from the source, fuzzes each machine that runs on a `VirtualClock`, and shows them in a live page on your Vite dev server. The viewer is [`@mantaq/viz`](../viz/README.md).

## Ways in

**Gate in tests**: see the docs page "Design gate in vitest" for `expectNoDesignErrors`, `expectReached` and `expectAllStatesReached`.

**Vite plugin**: a live page on your dev server that redraws, keeping your walk, when you save.

```ts
// vite.config.ts
import { mantaqViz } from "@mantaq/inspect/vite";

export default defineConfig({
  plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })],
});
// open /__mantaq/ while `vp dev` runs
```

The live page runs the real actor, so it needs an exported factory on a `VirtualClock`; instance or `RealClock` machines fall back to the static walk.

Options: `base` (default `/__mantaq/`), `fuzz` (`false`, or `{ seed, iterations }`; default 500 iterations so a save redraws fast).

**Library**: one call per machine.

```ts
import { inspect, vizDocument } from "@mantaq/inspect";
import { serializeViz } from "@mantaq/viz";

const { machine, warnings } = inspect({
  id: "cart",
  create: () => createCart(), // a fresh actor every call
  source: { file: "/abs/src/cart.ts", root: "/abs" }, // optional: explanations + payloads from types
  tests: [[{ kind: "event", event: "addItem", payload: { sku: "A1" } }]], // optional: "example tests" coverage
});
const json = serializeViz(vizDocument([machine]));
```

`inspectFile(file)` / `inspectModule(file, { load })` do the discovery the Vite plugin does. The building blocks (`toVizMachine`, `annotateMachine`, `fuzz`, `fuzzedMachine`, `withTestCoverage`, `guidance`) stay exported for custom pipelines.

## What it needs from your file

- **Exports.** An actor, or a function that returns one (or `{ actor }`). Functions are called with no arguments, with a `VirtualClock` when the first parameter is a clock, or with `{ clock }` when it is an options object with a `clock`. Functions with other required parameters are skipped. Discovery reads types only; nothing is called to find out.
- **A fresh actor per call**, to fuzz. A file that only exports one actor instance is drawn, not fuzzed. When a file has factories, its actor instances are skipped.
- **Exported factories.** Export a factory that takes ports and a clock, not only a built instance. See [Machines in an application](https://anderscan.github.io/mantaq/guides/machines-in-an-app/).
- **A factory, for the live page.** The page recreates the actor on every step, so it needs an exported factory; a file that only exports an instance stays a static walk, with the usual warning.
- **A `VirtualClock`**, to fuzz. An actor on the real clock is drawn, with a warning.

Every part that cannot run is skipped with a warning, never guessed.

## Coverage: two sources, two questions

The viewer's "Coverage from" picker dims elements with zero hits. What dimmed means depends on the source:

- **examples + fuzz** (`reached`): neither an example nor fuzzing reached this. The default when both sources are present, and the same merge `expectReached` uses. Fix a miss by adding an example to `tests`.
- **example tests** (`tested`): no test exercises this. Collected by replaying the event sequences you pass as `tests`, each on a fresh actor.
- **fuzz runs** (`coverage`): no fuzz run produced this. Fuzzing reaches almost everything, so little is dimmed. What does stay dimmed is usually a **declared but unreached edge**: the handler lists the target in `to`, but its guards may never allow it. Saga's `compensatingRefund -REFUND_DONE-> failed` is an example. The edge panel calls these out. Fuzzing is not proof, so check the handler.

## How each tool works

**Structure** (`toViz`, Phase 1): states come from the actor's `states`, edges from each registration's `to` (`actor.options.targets`): one edge per declared target, a `stay` edge when `to` is absent. `onAny` registrations draw from one `*` source per machine or region, never once per state. Coverage of a `*` edge counts every covered state; a state's own handler for the same event is not told apart. Nothing runs to find them. `@mantaq/traversal` still calls each handler with payload `{}` and each sample context, but only to label edges with the contexts that reach them and what they emit.

**Fuzzer** (`fuzz`, Phase 3): a fresh actor and `VirtualClock` per run, so it is synchronous and deterministic. Mutations: insert, delete, swap, payload leaf tweak, time advance, and **loop**. Loop repeats, 2–13 times or a compared literal's count, a step that changed the actor's context, so counter guards like `if (attempts > 10)` become reachable. A step that changes nothing is never looped. A run is kept when it reaches a new feature (`state:x`, `edge:a>e>b`, `stay:a>e`, `error:a>e`), then shrunk to 1-minimal. Internal events are injected only when the current state handles them, as a live effect would (core rejects the rest). Payloads come from the per-machine samples and are mutated leaf by leaf, keeping each leaf's JSON type and never dropping keys. So a handler that throws is a real finding, not a type violation the compiler would reject.

**Payloads** (`analyzeModule`): the TypeScript checker reads each handled event's payload type (`event("x")<{ ... }>()`) and builds samples: `"sample"` for strings, `1` for numbers, every member of a literal union (varied one field at a time), one element per array. The fuzzer mutates from there. Samples you pass replace them per event.

**AST** (`annotateMachine`, Phase 4): one `ts.Program` per source file with the project tsconfig. It finds `m.on(state, { event, handler })` / `m.onAny({ event, handler })` and resolves names from the literal types of `state.name` / `event.type`. It walks inline handlers: if/else, early returns, ternaries, and a ternary inside `state:`. A specific `on` wins over `onAny`, as at runtime.

**Guidance** (`guidance`, Phase 5): literal seeding plus a branch-distance guide built from AST comparisons on payload and context. It helps when handlers compare payload fields against literals far from the samples, or count in context toward a threshold. See `docs/atlas/phase5-comparison.md`.

## What it cannot show

- **Guards** are not evaluated. A declared edge says "the handler may return this", not "some input reaches it". Fuzz coverage and the AST's branch conditions are the evidence; neither is proof.
- **`onAny` routing on live actor state** (`actor.state.name`) cannot be drawn exactly: the `*` edges say "from any state, may go to X", not which state leads where. Register per-state `m.on` handlers instead, as checkout's `back` does. `routingWarnings(machine)` lists these handlers (the viewer and `inspect` warnings show them); it needs AST explanations.
- **Payload types** come from the source. Without `source`, the fuzzer knows only the shapes you sample. Loose types (`string`, `unknown`) give loose samples. The document's `payloadType` is always `null`.
- **Effects** are known by name and declared `sends` only. An effect without `sends` shows `sends not declared`, and its events fall under "other internal events". `inspect` warns when a declared send has no handler in the effect's state. Example fixtures stub effects, and the fuzzer stands in for them by injecting internal events. It can therefore produce event orders a real effect never would, but only in states that handle the event.
- **Regions**: the fuzzer observes the root actor only. Region transitions are probed but not fuzzed.
- **AST limits**: handlers passed by reference, returns inside `switch` / loops / `try`, and computed `event`s are `not_analyzed`, with a reason and snippet. Comparisons against actor state or computed values carry no guidance.
- **History** cannot distinguish an ignored event from a self-loop. The fuzzer can (`stay` vs `transition`), but probe-only coverage cannot.
- **Fuzzing is not proof.** An edge that is absent was not reached; it is not shown to be impossible.

## Fixtures

`src/fixtures/{checkout,auth,saga}.ts` copy the handlers of `packages/examples/*.test.ts` verbatim, with effects stubbed. The examples live in test files and cannot be imported, so the copies can drift from them. `credit.ts` (conditional handlers, far literals), `retry.ts` (context counter, `attempts > 10`) and `switchy.ts` (unsupported control flow) exist for the AST, loop and guidance tests.

## Repo scripts

```sh
vp run viz:export     # bundled examples -> packages/viz/public/examples/*.json (the viz dev page loads them)
vp run viz:compare    # blind vs guided fuzzing report (Markdown, 30 seeds)
```

`export` options: `[outDir] --iterations N --no-fuzz --no-ast`.
