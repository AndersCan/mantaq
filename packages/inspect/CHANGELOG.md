# Changelog

## 0.12.1

<sub>2026-11-07</sub>

- _(patch)_
  Live panel: next events are grouped like the static walk (Send an input, Effect reports back, Other internal events), with the effect each report comes from and its handler's doc, and the state's effects with their unhandled reports. Answer for a running effect by picking what it reports. Breaking: the live "Send an event" heading and `data-group="live"` list are gone; `[data-send]` and `[data-send-item]` are unchanged.

## 0.12.0

<sub>2026-11-07</sub>

- _(minor)_
  Notes can target an arrow (`on: edge <from> <event>`, still mantaq notes v1), and the dev server refuses notes on states or arrows the machine does not have. Breaking: none.
- _(minor)_ Click an arrow on the live page to leave a note on it for your coding agent. Breaking: none.
- _(minor)_
  Design findings: a state or event whose name is only generic status words (ok, loading, done, ...) or that has no doc comment is reported when the machine file is read. Breaking: pages and `expectNoDesignErrors` with `source` can report new findings; `VizFindingKind` gains `vagueName` and `undocumented`.

## 0.11.1

<sub>2026-11-07</sub>

- _(patch)_
  After an event, the live panel says what ran: what happened, the condition that decided it, the context fields that changed and the effects started. Results an effect sends back later show up on their own. Breaking: `VizLiveState` gains `after`; a hand-written `VizDriver` must fill it (it may also add `listen`). No known drivers outside `@mantaq/inspect`.

## 0.11.0

<sub>2026-11-07</sub>

- _(minor)_
  The dev server reads and appends notes next to machine files (`<file>.notes.md`, mantaq notes v1) at `/__mantaq/notes`, for this computer and the live page only. Breaking: none.
- _(minor)_
  Breaking: viz documents are version 12. `VizEvent.payloadType` is replaced by `payload` (the fields of the event's payload type, read from the types and their JSDoc), and `VizMachine.context` lists the fields of the actor's context type. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.
- _(minor)_ Click a state on the live page to leave a note for your coding agent. Breaking: none.

## 0.10.1

<sub>2026-11-07</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.7.0

## 0.10.0

<sub>2026-11-07</sub>

- _(minor)_ The live page shows two machines side by side with `?machine=<a>&compare=<b>`, each with its own walk.

## 0.9.0

<sub>2026-11-07</sub>

- _(minor)_ Breaking: `expectNoDesignErrors` fails on dead ends: a non-final state where no event is handled and no effect runs.
- _(minor)_
  Write `<machine>Expectations` next to a machine: `neverSee` and `mustSee` contexts per state, checked on every fuzz run. `expectNoDesignErrors` reports a hit with the events that reach it.
- _(minor)_
  Fuzz budget as time: `fuzz: { timeLimitMs }` stops at full coverage, the iteration cap, or the time limit, still seeded. `iterations` is now a cap: fuzzing stops early once every state and edge is covered, and `fuzz.iterations` in viz.json reports how many ran. The Vite dev default is `{ timeLimitMs: 2000 }` (was 500 iterations); `vite build` now defaults to 2000 iterations like `inspect` and Astro. Warns which states and edges fuzz never reached, with the iterations run and why it stopped, and when `inspect` without `source` sends events without payloads. A user timer callback that throws under `clock.advance` is now a fuzz error (event `advance`) with its replay path, instead of aborting `inspect`.
- _(patch)_
  Breaking: viz documents are version 11 (`fuzz.failedExpectations`); export stored `viz.json` files again. Findings gain the kinds never-see and must-see.
- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 0.8.0

<sub>2026-11-07</sub>

- _(minor)_ `<Machine>` shows a one-line findings summary; the findings are marked on the states.

## 0.7.0

<sub>2026-11-07</sub>

- _(minor)_
  The machine document records each machine's declared `outputs` (format version 10). Documents from older versions are refused; regenerate them.
- _(minor)_ `<Machines pages>` draws every machine and the events that link them.
- _(patch)_ `machineFindings` lists each design finding with its kind, state and the event path that reaches it.

## 0.6.1

<sub>2026-11-07</sub>

- _(patch)_
  Fuzzer: the loop operator repeats the whole cycle that changed context (`submit, rejected`), not only its last step, so counters bumped by a round trip are reached. Kept sequences are shrunk until no step can go.
- _(patch)_
  `?machine=<id>&run=<name>` opens a recorded run by name, and clicking a run puts that link in the address bar. An unknown name shows a notice instead of silently opening the start.

## 0.6.0

<sub>2026-11-06</sub>

- _(minor)_ Publish machine pages from Astro: `mantaqViz` from `@mantaq/inspect/astro` and `<Machine src>`.
- _(patch)_ Document the Astro integration in the README.

## 0.5.2

<sub>2026-11-06</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.6.0

## 0.5.1

<sub>2026-11-05</sub>

- _(patch)_ The live page redraws when a `__runs__/*.json` file changes, so re-recorded test runs show up without a save.

## 0.5.0

<sub>2026-11-05</sub>

- _(minor)_
  `vite build` with `mantaqViz` writes the live page as a static site (`index.html`, `viz.json` and a script under `base`).
- _(minor)_
  `tests` takes named runs (`{ name, steps }[]`) instead of bare step lists, and they show up as `machine.runs`. `inspectModule` reads recorded runs from `__runs__/*.json` next to the machine file, drops internal events a replay already produces, and drops runs that replay to a different end state with a warning. Breaking: wrap each step list in `{ name, steps }`.
- _(minor)_
  Add `recordRuns(factory)` (`@mantaq/inspect/record`) for vitest. Wrap a machine factory in a test file and each passing test is recorded to `__runs__/<test file>.json` next to it, where `inspectModule` picks it up as a named run. With `CI` set, a stale file fails the test. `vitest` is an optional peer dependency.
- _(patch)_
  The viz document (schema v9) carries named `runs` per machine, and the live page lists them in a Runs section. Clicking a run replays its steps on the actor and updates the shareable `?step=` link. Pages without a live driver show no Runs section.

## 0.4.0

<sub>2026-11-05</sub>

- _(minor)_
  Add `expectNoDesignErrors` for tests: it fails on handlers that throw under fuzzing, effects that send an event their state does not handle, and declared states no path leads to. `designErrors` and `unreachableStates` are exported for custom checks.
- _(minor)_
  Add `expectReached` and `expectAllStatesReached` for tests: they fail when fuzzing or your example `tests` never visited the listed states or took the listed transitions. `missedReach` and `reachedStates` are exported for custom checks.
- _(minor)_
  `fuzz()` accepts `initial` sequences that seed its corpus, and `inspect()` passes your example `tests` as that starting corpus.
- _(minor)_
  Remove the `mantaq-inspect` CLI, its `--json` and static HTML export, the `htmlPage` export and the `./live-embedded` export. For the viz document, call `inspect` and `toVizMachine` from the API. Use the Vite plugin (`@mantaq/inspect/vite`) for the visualizer and `expectNoDesignErrors` in tests to gate on design errors.
- _(patch)_ State nodes show their effects as chips, and effects no longer draw self-loop edges.
- _(patch)_ Document `expectNoDesignErrors`, `expectReached` and `expectAllStatesReached` in a vitest suite.
- _(patch)_
  The viewer drops its always-on legend and fuzz note and links to the visualizer docs page instead. The `STRUCTURE_BANNER` and `FUZZ_NOTE` exports from `@mantaq/viz/viewer` are removed.

## 0.3.0

<sub>2026-11-04</sub>

- _(minor)_
  `mantaq-inspect --live` writes a standalone HTML page that drives the real machines offline: the machine files and the driver are bundled in with Vite.

## 0.2.3

<sub>2026-11-03</sub>

- _(patch)_
  The JSDoc above `m.effect(...)` becomes the doc of the state's effect edge, and the walkthrough shows it under "Entering <state> runs".

## 0.2.2

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.3

## 0.2.1

<sub>2026-11-03</sub>

- _(patch)_ README: separate the static walk (nothing runs) from the live page (steps run the real actor).

## 0.2.0

<sub>2026-11-02</sub>

- _(minor)_
  States, events and edges carry a `doc` field (schema v8): `@mantaq/inspect` reads the
  leading JSDoc of `state(...)` / `event(...)` declarations and of `m.on` / `m.onAny`
  calls, and the viewer panel shows it for the current state and each next step.
- _(minor)_
  `mantaq inspect --check` exits 1 when the analysis reports design errors or warnings, including fuzz handler errors, so it can gate CI.
- _(minor)_
  `mantaq inspect --config FILE --mode MODE` loads the files with your project's Vite config, so env, aliases and plugins resolve as they do in your app. A file that fails to load now makes the CLI exit 1.
- _(minor)_
  The Vite plugin page now runs your machines for real: send inputs, advance the virtual clock and step back, with the walk kept in the URL and replayed on the new code when you save.
- _(patch)_ README: export factories so `mantaq-inspect` can fuzz them; links the new "Machines in an application" guide.

## 0.1.0

<sub>2026-11-01</sub>

- _(minor)_
  First public release. `@mantaq/viz` draws and walks a machine from a versioned
  JSON document; `@mantaq/inspect` turns a machine into that document and ships the
  `mantaq-inspect` CLI and a Vite plugin (`@mantaq/inspect/vite`).
