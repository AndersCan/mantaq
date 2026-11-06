# Changelog

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
