# Changelog

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
