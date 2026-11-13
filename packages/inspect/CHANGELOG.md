# Changelog

## 0.36.0

<sub>2026-11-13</sub>

- _(minor)_
  The live driver can try a step on a throwaway copy of the actor (`VizDriver.dryRun`) without changing the walk. Breaking: none.
- _(minor)_
  A file named `<machine file>.preview.ts` next to a machine draws the app's own screen for each state in a Screen tab on the live page, in a phone-width frame served by the dev server. Breaking: none; a file named `*.preview.ts` next to a machine is a preview, not a machine.
- _(patch)_
  On a live diagram, an arrow whose guard the current context does not meet is drawn blocked, with a lock and the reason, and sends nothing until the context allows it. Breaking: none.

## 0.35.0

<sub>2026-11-12</sub>

- _(minor)_
  Fuzzing takes sample payloads from the types of the events a machine accepts (the actor's `send` type and the `events` a factory returns), so a machine built by a helper such as `createPool` gets typed payloads and no false findings. `MachineExport` gains `samples`.

## 0.34.0

<sub>2026-11-12</sub>

- _(minor)_
  `ViewerOptions.diagramOnly` opens the viewer with only the diagram and a "Show controls" button. `<Machine diagramOnly />` (and `mountDriven({ diagramOnly: true })`) pass it on. The docs' getting-started steps, the home page, States (side by side) and the app-without-mantaq guide open this way, and step 1 no longer asks readers to ignore the tabs.
- _(minor)_ The viewer's "Coverage from" picker moves from the header into the Controls tab.
- _(minor)_
  A guarded arrow says when it reaches its state: step 6's `pay` arrow reads `email !== "" && items !== 0` under its name, and the green loop that fuzzing saw for the same guard is no longer drawn.
- _(minor)_
  Diagram only draws just the diagram: no finding marks or "?" hints on states, and `<Machine diagramOnly />` renders no design-findings banner. "Show controls" brings them back.
- _(patch)_
  In the live viewer, clicking an arrow for an event with data opens its form, and nothing is sent until Send. The Always ask toggle is gone. Breaking: none
- _(patch)_
  In the live viewer, a step names each effect it did not run and the events it would send ("Not run here: fetchList (it would send listFetched or fetchFailed)"). Breaking: none

## 0.33.0

<sub>2026-11-11</sub>

- _(minor)_ Add `machineBrief`: a machine as a Markdown brief of its states, events, conditions and effects.
- _(minor)_
  Record which parts of a machine talk. `VizMachine.partOutputs` (schema 16) holds the declared outputs of each region and actor map child, and `systemOf` joins them to the parts that handle them. A step that moves other parts says so: the Path reads `team.ITEM_ARRIVED {item a}, then w1: free → working`, and the panel says `Then w1 took team.ITEMS_ASSIGNED` instead of "came back".

  Breaking: documents with `schemaVersion` 15 are refused; regenerate them. Hand-built `VizMachine` values need `partOutputs: {}`.

- _(minor)_
  `mantaq-check-site --overview <path>` fails when the page at that path is not built or shows no `<Machines>` overview. Breaking: none

## 0.32.0

<sub>2026-11-10</sub>

- _(minor)_
  The live diagram has a Controls tab with Full screen, Always ask and Diagram only. Diagram only shows just the diagram and a Show controls button.
- _(minor)_
  Breaking: `toViz`/`toVizMachine` no longer take `history` or `sampleContexts` (coverage comes from `fuzzedMachine` and `withTestCoverage`); removed `analyzeSource` (use `analyzeModule`). The viz "supplied run" coverage mode stays, but nothing in this repo produces it.
- _(patch)_
  inspect: a listener that starts with `if (e.type !== X) return;` now counts as hearing only X, and sends after it are labelled with X

## 0.31.0

<sub>2026-11-10</sub>

- _(minor)_
  `<Machine runEffects />` runs that diagram's effects in the reader's browser, so its timers move when the time buttons are pressed. Off by default.

  Breaking: none

- _(minor)_
  Notes on the live viz open by right-clicking a state or arrow; no notes box on the page. Breaking: none (the notes endpoint no longer takes journeys, which nothing sends since the journey box was removed)
- _(minor)_
  The live driver lists children that are gone as `VizLiveState.removed`, each with the step that removed it.

  Breaking: none

- _(minor)_
  Fuzz runs and test replays record actor-map children: child states and edges get coverage, and child handler errors become findings.

  Breaking: none. Machines with actor maps now get coverage on child states and may get new findings on them, so a `failOnFindings` build can newly fail on a real bug.

- _(minor)_
  Fuzzing sends events to actor-map children that an earlier step started, by key, so child states are reached and their findings replay.

  Breaking: none.

- _(minor)_
  Viewer text, lines and controls are black and white; colour appears only on graph highlights.

  Breaking: `--accent` no longer colours controls (they use `--fg`). Themed embeds should also map the new `--select`, `--grid` and `--shadow` variables.

- _(patch)_
  The live page no longer scrolls when an edge is clicked, drops the "save as journey" box, and shows real buttons with a single filled Send.

  Breaking: none

- _(patch)_
  Clicking an edge on the live viz fires it with a value the page already knows (what you sent before, else the first fuzz value, else the type's example). An "Always ask" toggle in the header opens the form first.

  Breaking: none

- _(patch)_
  The payload form on the live viz starts at the values a click would send. "Values from" is a row of buttons (Last sent, Fuzz 1, Fuzz 2, Example, Context), a choice field of up to four options is a button row, and "Edit as JSON" is gone.

  Breaking: none

- _(patch)_
  The live viz drops its explaining text. A held effect shows as one line ("In submitting, waiting for chargeCard") and its answers are the arrows out of the state. The event lists and the time controls sit in one closed "Events and time" fold under the step line, which stays as you left it across steps and Back. The design-findings banner no longer tells you to click a `!`.

  Breaking: none

- _(patch)_
  The live viz draws each actor-map child as a marker with its key on its state; an arrow in the child graph goes to the picked child, else the one that started first. Breaking: none (map-child states draw taller, with a marker row)
- _(patch)_
  On the live viz, clicking an event that started a child sends the next free key, so repeated adds start new children; a field's @example comes before fuzz values.

  Breaking: none

## 0.30.0

<sub>2026-11-08</sub>

- _(minor)_
  Fuzzing records each event it sent without a payload whose fields the machine then read: `Trace.missingPayloads`, `FuzzResult.missingPayloads` and `Inspected.missingPayloads` (type `MissingPayload`). The vague "no source" warning is replaced by one exact line per such event, and no longer appears for events the machine reads nothing from.

  Breaking: none

- _(minor)_
  `expectReached`, `expectAllStatesReached` and `expectNoDesignErrors` stop when fuzzing sent an event without a payload and the machine read a field of it. The error names each event and the fields read, and says to pass `source` or `payloads`. Before, such a check passed on an event the app cannot send, blamed the handler for a payload the types forbid, or told you to raise `fuzz.iterations`.

  Breaking: expectReached, expectAllStatesReached and expectNoDesignErrors now fail when fuzzing sent an event without a payload and the machine read one — affects tests without source or payloads for such events: add them.

## 0.29.0

<sub>2026-11-08</sub>

- _(minor)_
  The machines overview names, on each app-code connection, the receiver's states that have no handler for the event it sends.

## 0.28.0

<sub>2026-11-08</sub>

- _(minor)_ Hosted `<Machine>` diagrams collect notes and journeys in the tab and copy them for your coding agent.

## 0.27.0

<sub>2026-11-08</sub>

- _(minor)_
  A live step lists the outputs the machine sent out, as "Sent out: …", and names where the app takes each one when the page passes `routes` to the viewer. Breaking: `VizLiveStep.sent` is now required, so a hand-written `VizDriver` must fill it (`[]` when nothing was sent).
- _(minor)_
  Astro `<Machine>` pages tell the viewer where the app takes each output, so a live step reads "Sent out: openAlbum → router takes NAVIGATED (file:line)".

## 0.26.1

<sub>2026-11-08</sub>

- _(patch)_ Updated dependency `@mantaq/viz` v0.20.1

## 0.26.0

<sub>2026-11-08</sub>

- _(minor)_
  The machines overview draws a dashed arrow to no machine for declared outputs no app code listens to. Listener checks against an event constant (`e.type === x.type`) now name the trigger.

## 0.25.0

<sub>2026-11-08</sub>

- _(minor)_
  `recordRuns` replays a test that passes options besides `clock` the way the page does, with only `{ clock }`, and fails the test when it ends elsewhere, naming the options. Breaking: such a test used to pass while its run was left off the page; build its actor with only the clock, or give the factory defaults that act like those options.

## 0.24.0

<sub>2026-11-08</sub>

- _(minor)_ The machines overview draws a machine dashed, and lists it under the diagram, when no app code uses its factory.

## 0.23.0

<sub>2026-11-08</sub>

- _(minor)_
  A walk link may name several machines (`?machine=a&machine=b&run=<name>`): each viewer on the page opens that run, and `mantaq-check-site --links` checks every machine named.

## 0.22.0

<sub>2026-11-08</sub>

- _(minor)_
  The machines overview also draws connections made in app code (a listener on one machine's output or change that sends to another), labelled `trigger → event` and listed under the diagram with the line that sends.

## 0.21.0

<sub>2026-11-08</sub>

- _(minor)_
  `mantaq-check-site` takes `--links <file>` (repeatable) and `--site <url>`: every markdown link in the file to a run under the site address is opened in Chromium, and the check fails when the page is not built, no viewer there holds the machine, or the viewer says "No run named ...".
- _(minor)_
  `mantaqViz({ failOnFindings: true })` fails `astro build` when a recorded run does not replay on the page. The drop warning now says how to fix it: build the test's actor with only a clock, or give the factory defaults that act like the test's options. Breaking: sites using `failOnFindings` with such a run now fail to build; fix the run as the message says.

## 0.20.0

<sub>2026-11-08</sub>

- _(minor)_
  The live viewer shows an actor map's children: one row per child with its state, its own Send list, and the child's graph drawn once in a box labelled "one per key". The browser harness gains `children()` and `sendTo({ map, key }, …)`.

## 0.19.0

<sub>2026-11-08</sub>

- _(minor)_
  A handler (`m.on`, `m.onAny`) or a state's effects with no `/** */` comment are now naming notes that name the event, state, file and line.

  Breaking: `expectNoDesignErrors` with `source`, and `mantaqViz({ failOnFindings: true })`, now fail on a handler or a state's effects with no `/** */` comment. This affects machines with such handlers: add the comment.

- _(minor)_
  Actor maps reach the inspector. `ActorMap.get(key)` returns the live child. Return the map next to the actor (`return { actor, photos }`) and the inspector draws one child's states as a compartment named after the map, the live driver lists the children (`VizLiveState.children`) and steps can go to one (`actor: { map, key }`, `photos[p1]>uploadConfirmed` in links).

  Breaking: document format v15 (`VizMachine.maps`) — affects anyone serving a prebuilt viz.json; rebuild it.

  Breaking: VizLiveState.children is required — affects custom VizDriver implementations.

## 0.18.1

<sub>2026-11-08</sub>

- _(patch)_
  Breaking: region dead ends and unreachable region states are now design findings. The live viewer shows each region's state, groups the Send buttons per region and sends them to that region, and draws a start arrow for each region.

## 0.18.0

<sub>2026-11-08</sub>

- _(minor)_
  The live driver holds effects: they do not run, and `VizLiveState.waiting` names the ones waiting for an answer. `createDriver(target, { effectMode: "real" })` runs them.

  Breaking: createDriver holds effects by default — affects code calling @mantaq/inspect/drive directly (none found in mantaq apps or justus); pass { effectMode: "real" } to keep running them.

  Breaking: VizLiveState has required effectMode and waiting — affects custom VizDriver implementations (none known).

- _(minor)_ A payload field's `@example` JSDoc tag is the value the viz form starts with.
- _(minor)_
  Design findings say what is wrong in the machine's own names: a headline, a proof (for an unreachable state, the arrows into it and the states the machine can reach) and a fix. A declared input or internal event that no state handles is now a finding. Naming notes (vague or undocumented names) are flagged as notes.

  Breaking: `VizFinding.state` is nullable, and `title`, `proof`, `fix`, `event`, `note` and `noReplay` are new required fields — affects code reading `@mantaq/viz` findings. A declared input or internal event that no state handles is now a design finding — affects `expectNoDesignErrors` and `failOnFindings` on such machines.

- _(minor)_
  A step can name the region it goes to (`actor: { region }`), in the live driver, the fuzzer, saved journeys and shared links (`upload>photoPicked`). Each region's start state is marked `initial`, and `VizLiveState.regions` lists where every region is.

  Breaking: document format v14 — affects anyone serving a prebuilt viz.json; rebuild it.

  Breaking: VizLiveState has a required regions and VizLiveOutcome gains "missing" — affects custom VizDriver implementations and exhaustive switches on the outcome (none known).

- _(minor)_
  The Astro `<Machine>` banner names the design findings: how many, in which machine, their headlines, and where to look (the `!` marks on the diagram, or the top of the Details tab for an event no state handles). Naming notes no longer count as findings.

## 0.17.0

<sub>2026-11-08</sub>

- _(minor)_
  The live driver reports the current state's payload as `VizLiveState.payload`. Breaking: a custom `VizDriver` must return `payload`.

## 0.16.0

<sub>2026-11-07</sub>

- _(minor)_
  The live dev page can save a walk as a named journey in the machine's notes file, for your coding agent to turn into a test. Breaking: none.
- _(minor)_
  The live viz page has a Save journey box that saves the current walk as a named journey. Breaking: none.
- _(minor)_
  Breaking: viz documents are version 13. `VizFuzz.expectations` lists every rule the machine file writes (`neverSee` and `mustSee`) with `held`, whether fuzzing kept it; `failedExpectations` still lists the ones that broke. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.

## 0.15.0

<sub>2026-11-07</sub>

- _(minor)_
  `mantaqViz({ failOnFindings: true })` makes `astro build` fail on any design finding, a machine that could not be fuzzed, or an expectation that is not checked, listing each with the events that lead there. `astro dev` is unchanged. `expectNoDesignErrors` now prints the `after:` path for every finding that has one. Breaking: none.

## 0.14.0

<sub>2026-11-07</sub>

- _(minor)_
  The live dev page outlines the states and arrows your last edits added and lists what they removed, until you press Mark as seen. Breaking: none.

## 0.13.0

<sub>2026-11-07</sub>

- _(minor)_
  Add `mantaq-check-site <dir> [--base]`: serves a built Astro site and checks in Chromium that every machine draws, every live machine handles an event, and every overview box opens a built page showing its machine. `playwright` is an optional peer.

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
