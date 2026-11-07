# Changelog

## 0.9.0

<sub>2026-11-07</sub>

- _(minor)_
  Breaking: viz documents are version 11 (`fuzz.failedExpectations`); export stored `viz.json` files again. Findings gain the kinds never-see and must-see.
- _(minor)_ Breaking: `expectNoDesignErrors` fails on dead ends: a non-final state where no event is handled and no effect runs.
- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 0.8.0

<sub>2026-11-07</sub>

- _(minor)_ States with design findings carry a ! mark; click it to read the finding and replay the path that found it.

## 0.7.0

<sub>2026-11-07</sub>

- _(minor)_
  The machine document records each machine's declared `outputs` (format version 10). Documents from older versions are refused; regenerate them.
- _(minor)_ `machineFindings` lists each design finding with its kind, state and the event path that reaches it.

## 0.6.0

<sub>2026-11-07</sub>

- _(minor)_
  Live viewer asks for an event's payload in a popover on the diagram, filled with a fuzz sample, instead of sending the event without one. The panel is tabbed (Step, Context, Path, Details) and sits below the graph unless the viewer is wide; text and graph size in rem/em, and host page styles no longer leak in.
- _(minor)_
  `?machine=<id>&run=<name>` opens a recorded run by name, and clicking a run puts that link in the address bar. An unknown name shows a notice instead of silently opening the start.

## 0.5.0

<sub>2026-11-06</sub>

- _(minor)_ Add a fullscreen button to the viewer.

## 0.4.0

<sub>2026-11-05</sub>

- _(minor)_
  The viz document (schema v9) carries named `runs` per machine, and the live page lists them in a Runs section. Clicking a run replays its steps on the actor and updates the shareable `?step=` link. Pages without a live driver show no Runs section.

## 0.3.0

<sub>2026-11-05</sub>

- _(minor)_
  The viewer drops its always-on legend and fuzz note and links to the visualizer docs page instead. The `STRUCTURE_BANNER` and `FUZZ_NOTE` exports from `@mantaq/viz/viewer` are removed.
- _(patch)_ The viewer's live context is now a collapsible, pretty-printed panel; the fold state is kept as you step.
- _(patch)_ State nodes show their effects as chips, and effects no longer draw self-loop edges.
- _(patch)_ The live context panel highlights the lines that changed in the last step.
- _(patch)_ Hovering or focusing an effect chip highlights the edges it sends and labels them with the effect name.
- _(patch)_ Effect chips without a declared `sends` show a "?" with the hint "declare `sends` to see links".
- _(patch)_
  Layout keeps a minimum edge length and node separation, and dotted edges scale their dot spacing with edge length so they never read as solid lines.
- _(patch)_ The coverage overlay merges reach from example runs with fuzz reach.
- _(patch)_ Edge labels in the viewer no longer overlap each other.

## 0.2.3

<sub>2026-11-03</sub>

- _(patch)_
  The JSDoc above `m.effect(...)` becomes the doc of the state's effect edge, and the walkthrough shows it under "Entering <state> runs".

## 0.2.2

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/utils` v0.0.5

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
  `VizDriver` and `VizLiveState` types, and `mountViewer(root, doc, { driver })`: with a
  driver the explore panel sends each step to the running actor, follows its real state and
  shows the outcome (transition, stay, ignored), effects run, context and handler errors.
- _(minor)_
  Live mode controls: one button per pending timer, a free "advance ms" input, payload entry
  (JSON box or a sample the fuzzer sent), and `?step=` links that carry advances and payloads
  and replay through the driver on open.

## 0.1.0

<sub>2026-11-01</sub>

- _(minor)_
  First public release. `@mantaq/viz` draws and walks a machine from a versioned
  JSON document; `@mantaq/inspect` turns a machine into that document and ships the
  `mantaq-inspect` CLI and a Vite plugin (`@mantaq/inspect/vite`).
