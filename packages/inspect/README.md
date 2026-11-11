# @mantaq/inspect

Turns your Mantaq machine into a picture you can walk: add the Vite plugin, no other config.

It finds every exported actor, or function that builds one, from the file's types. It reads handler explanations and sample payloads from the source, fuzzes each machine that runs on a `VirtualClock`, and shows them in a live page on your Vite dev server. The viewer is [`@mantaq/viz`](../viz/README.md).

## Install

```sh
npm install -D @mantaq/inspect vite
```

`vite` is a peer dependency; `vitest` (for `@mantaq/inspect/record`) and `astro` are optional peers.

## Ways in

**Gate in tests**: see the docs page "Design gate in vitest" for `expectNoDesignErrors`, `expectReached` and `expectAllStatesReached`.

**Vite plugin**: a live page on your dev server that redraws, keeping your walk, when you save.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { mantaqViz } from "@mantaq/inspect/vite";

export default defineConfig({
  plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })],
});
```

Start the dev server (`npx vite`, or your `npm run dev` script) and open `http://localhost:5173/__mantaq/`. `?machine=<id>` selects one machine; the id is the export name without `create` / `Actor` (`createCheckoutActor` → `checkout`). `?machine=<a>&compare=<b>` shows two machines side by side, each with its own walk, for choosing between two drafts.

On the dev server, click a state or an arrow to leave a note; it is saved in `<machine file>.notes.md` next to the machine for your coding agent (see the mantaq skill). After each redraw the page outlines the states and arrows that are new since you opened it, and lists what was removed, until you press "Mark as seen".

The live page runs the real actor, so it needs an exported factory on a `VirtualClock`; instance or `RealClock` machines fall back to the static walk.

Effects do not run on the live page: the driver holds them and the panel asks what each one reports. The initial state's effects are the exception (core runs them while the actor is built). `createDriver(target, { effectMode: "real" })` from `@mantaq/inspect/drive` runs them.

`vite build` with the plugin also writes the page as a static site: `index.html`, `viz.json` and a script under `base` (set `base: "/"` to put them at the output root). Machines load through your Vite config, and the fuzz runs at build time.

Options: `base` (default `/__mantaq/`), `fuzz` (`false`, or `{ seed, iterations, timeLimitMs }`).

- `timeLimitMs`: wall-time budget per machine. Fuzzing stops at the first of: every state and edge covered, `iterations` (no cap if only `timeLimitMs` is set), or the time limit. Runs stay seeded (same seed, same sequence); only how many ran depends on machine speed.
- Dev default: `{ timeLimitMs: 2000 }`. A small machine stops at full coverage in milliseconds, so a save redraws fast; one fuzz cannot cover costs at most 2 s.
- `vite build` default: 2000 iterations, no time limit, so `viz.json` is reproducible.
- A state or edge fuzz never reached is a warning in the `[mantaq-viz]` log, with the iterations run and why it stopped. Raise `timeLimitMs` / `iterations`, or add a named run.

**Astro**: publish a site where each page is prose plus the diagram. Add the integration, list the machine files, and put `<Machine>` on a page (add `runEffects` to run that diagram's effects).

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { mantaqViz } from "@mantaq/inspect/astro";

export default defineConfig({
  integrations: [mantaqViz({ machines: ["src/machines/checkout.ts"] })],
});
```

```astro
---
import Machine from "@mantaq/inspect/astro/Machine.astro";
---
<Machine src="src/machines/checkout.ts" />
```

`astro build` writes, per `<Machine>`, a one-line count of design findings, then the diagram with the live panel. Each state with a finding (unreachable, a handler that throws under fuzzing, an effect sending an event nobody handles) carries a ! mark; click it to read the finding and replay the path. `?machine=<id>&step=` walks work as on the Vite page. `?machine=<id>&run=<name>` opens a recorded run by name; use it for links in docs and issues. Repeat `machine=` (`?machine=a&machine=b&run=<name>`) to open the run of that name in each named machine's viewer on the page, for example both people's sides of one story; viewers holding none of them are left alone.

- **Two lists.** A file is named twice: in `machines` (paths, not globs; relative to the Astro root or absolute) and in the page's `src`. The browser script is built before pages render, so it cannot learn the list from the pages.
- **What fails the build.** An empty `machines`, a missing file, a file that cannot load, two files exporting the same machine id, a `src` that is not in `machines`, and a file with no exported actor. Design findings do not fail the build by default; they show on the page. Pass `failOnFindings: true` and `astro build` fails on any design finding, a machine that could not be fuzzed, an expectation that is not checked, or a recorded run that does not replay, listing each with the events that lead there; `astro dev` is unchanged.
- **Options.** `fuzz`: `false` for structure only, or `{ seed, iterations, timeLimitMs }` (see the Vite options). Default: seeded, up to 2000 iterations (stops early at full coverage), no time limit, so builds are reproducible.
- **Running effects.** By default the live panel holds each effect and asks what it reports. `runEffects` runs that diagram's effects in the reader's browser; timers still wait for the time buttons. Use it for machines whose effects only use the clock.
- Needs `astro` `^7` (optional peer). The live panel needs the same exported factory on a `VirtualClock` as the Vite page; other machines show the static walk.

**Overview of all machines.** `<Machines pages={...} />` draws every machine given to `mantaqViz` as a box. An arrow goes from A to B labelled `e` when `e` is in A's declared `outputs` and B handles `e` as an input. It is also drawn when app code that listens to A (`onOutput(a, ...)`, `a.on("output" | "change", ...)`) can send an event to B, labelled `trigger → event` and listed under the diagram with the line that sends. Calls are followed two levels deep. Test files are skipped. A machine is drawn dashed, and listed under the diagram, when no app code uses its factory. App code is the files of the machine's tsconfig except test files. A call, or passing the factory as a value, counts. A machine exported only as an actor instance always counts as run.

```astro
---
import Machines from "@mantaq/inspect/astro/Machines.astro";
---
<Machines pages={{ "": ["src/machines/cart.ts"], checkout: ["src/machines/checkout.ts"] }} />
```

`pages` maps a page path under the site base (`""` is the home page) to the machine files shown on it, as given to `machines`. Clicking a box opens that page with `?machine=<id>` selected. The build fails when a listed file is not in `machines` or a machine's file is on no page. It is plain SVG; no script runs.

**Library**: one call per machine.

```ts
import { inspect, vizDocument } from "@mantaq/inspect";
import { serializeViz } from "@mantaq/viz";
import type { AnyActor } from "@mantaq/core";

declare function createCart(): AnyActor<unknown>;

const { machine, warnings } = inspect({
  id: "cart",
  create: () => createCart(), // a fresh actor every call
  source: { file: "/abs/src/cart.ts", root: "/abs" }, // optional: explanations + payloads from types
  tests: [
    { name: "add an item", steps: [{ kind: "event", event: "addItem", payload: { sku: "A1" } }] },
  ], // optional: named runs for "example tests" coverage
});
const json = serializeViz(vizDocument([machine]));
```

`inspectFile(file)` / `inspectModule(file, { load })` do the discovery the Vite plugin does, and read recorded runs from `__runs__/*.json` next to the machine file (`{ [machineId]: { name, end, steps }[] }`). A run is replayed on a fresh actor; internal events the replay already produces (timers, synchronous emits) are dropped, and a run that replays to a different state than `end` is dropped with a warning. The building blocks (`toVizMachine`, `annotateMachine`, `fuzz`, `fuzzedMachine`, `withTestCoverage`, `guidance`) stay exported for custom pipelines.

`machineBrief(machine)` turns a machine into a Markdown brief of its states, the events each takes and under which condition, entry effects and ignored events, for whoever builds the feature.

## Check the built site

```sh
npm i -D playwright && npx playwright install chromium
astro build && mantaq-check-site dist --base /docs
```

`mantaq-check-site <dir> [--base <path>] [--overview <path>] [--links <file> ... --site <url>]` serves the built Astro site, opens every page that holds a machine in headless Chromium and prints one line per problem, naming the page and the machine:

- a machine draws no diagram;
- a live machine handles none of the events it offers;
- an overview box (`<Machines>`) links to a page that was not built, or to a page that shows no viewer for that machine (the overview is what makes "this page shows its machine" checkable);
- with `--overview <path>` (the page's path under `--base`, like `flows/`), that page is not built or shows no `<Machines>` overview;
- a page throws or logs an error in the browser.
- with `--links <file>` (repeatable) and `--site <url>` (the address the site is published at), a markdown link `[text](url)` in the file that points under `--site` and carries `run=` opens no walk: its page is not built, no viewer there holds the machine, or the viewer says "No run named ...". One line per link: `<file>:<line>: walk link "<text>": <reason>`.

`--base` is the Astro `base` (default `/`). Exit codes: 0 ok, 1 problems found, 2 could not run (usage, no `playwright`, no Chromium). `playwright` is an optional peer dependency; set `CHROMIUM_PATH` to use a Chromium you already have.

## What it needs from your file

- **Exports.** An actor, or a function that returns one (or `{ actor }`). Functions are called with no arguments, with a `VirtualClock` when the first parameter is a clock, or with `{ clock }` when it is an options object with a `clock`. Functions with other required parameters are skipped. Discovery reads types only; nothing is called to find out.
- **A fresh actor per call**, to fuzz. A file that only exports one actor instance is drawn, not fuzzed. When a file has factories, its actor instances are skipped.
- **Exported factories.** Export a factory that takes ports and a clock, not only a built instance. See [Machines in an application](https://anderscan.github.io/mantaq/guides/machines-in-an-app/).
- **A factory, for the live page.** The page recreates the actor on every step, so it needs an exported factory; a file that only exports an instance stays a static walk, with the usual warning.
- **Expectations, optional.** Export `<machine id>Expectations` (type `Expectations<typeof createXActor>`) with `neverSee` and `mustSee` contexts per state. Fuzzing reports a never-see that was reached, and a must-see that no run reached. See [Design gate](https://anderscan.github.io/mantaq/guides/design-gate/).
- **A `VirtualClock`**, to fuzz. An actor on the real clock is drawn, with a warning.

Every part that cannot run is skipped with a warning, never guessed.

## Coverage: two sources, two questions

The viewer's "Coverage from" picker in the Controls tab dims elements with zero hits. What dimmed means depends on the source:

- **examples + fuzz** (`reached`): neither an example nor fuzzing reached this. The default when both sources are present, and the same merge `expectReached` uses. Fix a miss by adding an example to `tests`.
- **example tests** (`tested`): no test exercises this. Collected by replaying the named runs you pass as `tests`, each on a fresh actor.
- **fuzz runs** (`coverage`): no fuzz run produced this. Fuzzing reaches almost everything, so little is dimmed. What does stay dimmed is usually a **declared but unreached edge**: the handler lists the target in `to`, but its guards may never allow it. Saga's `compensatingRefund -REFUND_DONE-> failed` is an example. The edge panel calls these out. Fuzzing is not proof, so check the handler.

## How each tool works

**Structure** (`toViz`, Phase 1): states come from the actor's `states`, edges from each registration's `to` (`actor.options.targets`): one edge per declared target, a `stay` edge when `to` is absent. `onAny` registrations draw from one `*` source per machine or region, never once per state. Coverage of a `*` edge counts every covered state; a state's own handler for the same event is not told apart. Nothing runs to find them. `@mantaq/traversal` still calls each handler with payload `{}` and each sample context, but only to label edges with the contexts that reach them and what they emit.

**Fuzzer** (`fuzz`, Phase 3): a fresh actor and `VirtualClock` per run, so it is synchronous and deterministic. Mutations: insert, delete, swap, payload leaf tweak, time advance, and **loop**. Loop repeats, 2–13 times or a compared literal's count, a step that changed the actor's context, together with the cycle that leads back to the state it ended in (`submit, rejected` when the rejection returns to the form), so counter guards like `if (attempts > 10)` become reachable. A step that changes nothing is never looped. A run is kept when it reaches a new feature (`state:x`, `edge:a>e>b`, `stay:a>e`, `error:a>e`), then shrunk to 1-minimal. Internal events are injected only when the current state handles them, as a live effect would (core rejects the rest). Payloads come from the per-machine samples and are mutated leaf by leaf, keeping each leaf's JSON type and never dropping keys. So a handler that throws is a real finding, not a type violation the compiler would reject.

**Payloads** (`analyzeModule`): the TypeScript checker reads each handled event's payload type (`event("x")<{ ... }>()`) and builds samples: `"sample"` for strings, `1` for numbers, every member of a literal union (varied one field at a time), one element per array. The fuzzer mutates from there. Samples you pass replace them per event.

**AST** (`annotateMachine`, Phase 4): one `ts.Program` per source file with the project tsconfig. It finds `m.on(state, { event, handler })` / `m.onAny({ event, handler })` and resolves names from the literal types of `state.name` / `event.type`. It walks inline handlers: if/else, early returns, ternaries, and a ternary inside `state:`. For a state with its own `on`, the AST explains that handler; at runtime `onAny` also runs after it and moves only if the state's handler stayed.

**Guidance** (`guidance`, Phase 5): literal seeding plus a branch-distance guide built from AST comparisons on payload and context. It helps when handlers compare payload fields against literals far from the samples, or count in context toward a threshold. See [`docs/atlas/phase5-comparison.md`](https://github.com/AndersCan/mantaq/blob/main/docs/atlas/phase5-comparison.md).

## Record runs from your tests

In a vitest file, wrap the factory once and your tests become runs:

```ts
import { recordRuns } from "@mantaq/inspect/record";
import type { AnyActor, VirtualClock } from "@mantaq/core";

declare function createInviteLinkActor(clock?: VirtualClock): AnyActor<unknown>;

const make = recordRuns(createInviteLinkActor);
```

Every passing test that builds an actor with `make` writes its events and clock moves to `__runs__/<test file>.json` next to the test, keyed by machine id. `inspectModule` and the Vite plugin read those files, so each test shows up in the live page's Runs list and counts as an example run. Run the whole test file to refresh it. With `CI` set, a run that differs from the committed file fails the test, like a stale snapshot. The factory may be called in the test or in `beforeEach`; a retried test is recorded once. Runs with a payload that does not survive JSON (functions, `bigint`, `Map`, class instances) are skipped with a warning. `vitest` is an optional peer dependency.

## What it cannot show

- **Guards** are not evaluated. A declared edge says "the handler may return this", not "some input reaches it". Fuzz coverage and the AST's branch conditions are the evidence; neither is proof.
- **`onAny` routing on live actor state** (`actor.state.name`) cannot be drawn exactly: the `*` edges say "from any state, may go to X", not which state leads where. Register per-state `m.on` handlers instead, as checkout's `back` does. `routingWarnings(machine)` lists these handlers (the viewer and `inspect` warnings show them); it needs AST explanations.
- **Payload types** come from the source. Without `source`, the fuzzer knows only the shapes you sample. Loose types (`string`, `unknown`) give loose samples. Context and payload fields (`machine.context`, `events[].payload`) are read from the types and their JSDoc; `inspect(target)` leaves `context` null because the target names no export.
- **Effects** are known by name and declared `sends` only. An effect without `sends` shows `sends not declared`, and its events fall under "other internal events". `inspect` warns when a declared send has no handler in the effect's state. Example fixtures stub effects, and the fuzzer stands in for them by injecting internal events. It can therefore produce event orders a real effect never would, but only in states that handle the event.
- **Regions**: the fuzzer observes the root actor only. Region transitions are probed but not fuzzed.
- **AST limits**: handlers passed by reference, returns inside `switch` / loops / `try`, and computed `event`s are `not_analyzed`, with a reason and snippet. Comparisons against actor state or computed values carry no guidance.
- **History** cannot distinguish an ignored event from a self-loop. The fuzzer can (`stay` vs `transition`), but probe-only coverage cannot.
- **Fuzzing is not proof.** An edge that is absent was not reached; it is not shown to be impossible.

## Contributing (repo only)

These sections apply to the [mantaq repo](https://github.com/AndersCan/mantaq), not to the npm package.

### Fixtures

`src/fixtures/{checkout,auth,saga}.ts` copy the handlers of `packages/examples/*.test.ts` verbatim, with effects stubbed. The examples live in test files and cannot be imported, so the copies can drift from them. `credit.ts` (conditional handlers, far literals), `retry.ts` (context counter, `attempts > 10`) and `switchy.ts` (unsupported control flow) exist for the AST, loop and guidance tests.

### Repo scripts

```sh
vp run viz:compare    # blind vs guided fuzzing report (Markdown, 30 seeds)
```

`export` options: `[outDir] --iterations N --no-fuzz --no-ast`.
