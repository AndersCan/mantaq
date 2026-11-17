# Changelog

## 0.37.0

<sub>2026-11-17</sub>

- _(minor)_
  Fuzzing records each message one machine sends another, with the state it was sent from and the arrow that took it, in `machine.fuzz.messages`. Viz documents are schema 18.

  Breaking: viz document schema 17 → 18, a new required `machines[].fuzz.messages`; the validator refuses a 17 document with `schemaVersion: expected 18, got 17`. Rebuild with the matching @mantaq/inspect.
  Breaking: the board's dotted lines will follow the recorded messages once the viewer reads them; lines for same-named but unwired events then disappear, and lines for renamed wires and `onAny` handlers appear.

- _(patch)_
  A dotted line between machines is drawn for each message fuzzing saw the code send, so a wire that renames its event or ends in an `onAny` handler gets one and an unwired same-named event does not.

## 0.36.0

<sub>2026-11-17</sub>

- _(minor)_
  [user]: The live board draws a dotted line for each message one machine sends another, from the sender's state to the arrow that takes it.

## 0.35.0

<sub>2026-11-17</sub>

- _(minor)_
  A click on an arrow sends the first fuzz payload that takes that arrow, so arrows from the start open their states; a value typed in the Context box is now always kept and sent
- _(patch)_ Clicking an arrow or its ? no longer scrolls the page; a state click still brings the panel into view

## 0.34.0

<sub>2026-11-17</sub>

- _(minor)_
  [user]: An event with no declared fields always sends the fuzzer's sample payload (Details shows it after Send); it no longer copies a payload sent earlier in the walk, which nobody could see or change.
- _(patch)_
  [user]: A child chip in a final state looks like every other chip; its state's double border already says final. Worker rows drop " (final)".
- _(patch)_
  [user]: Every chip shows its child's key: as many pills as fit, then "+N" (hover lists the rest). The unlabelled dots are gone.
- _(patch)_
  [user]: The Step tab drops the "Because:" line (the arrow shows its guard), says "took" for a step that came back, and drops the source location from "Sent out".
- _(patch)_
  [user]: Loops use the same arrow head as other arrows, and internal-event labels are upright; the dotted line marks them.
- _(patch)_ [user]: Unused styles go, including .toolbar in page.css; disabled Back and Reset show the default cursor.

## 0.33.0

<sub>2026-11-16</sub>

- _(minor)_ [user]: The Full screen button is back above the diagram; in full screen the diagram widens to fill it.
- _(minor)_
  [user]: A click on an arrow the walk can take sends its event; on any other arrow it opens Details with why. A small ? beside each arrow label opens Details without sending. Labels are 12px wider for it.
- _(patch)_ [user]: Arrows the walk can take next move again; reduced-motion users get still arrows.
- _(patch)_ [user]: A timer's arrow now says it fires on its own and how many milliseconds are left; a click sends it now.

## 0.32.0

<sub>2026-11-16</sub>

- _(minor)_
  [user]: A viewer without a `driver` shows the diagram and Details only; the hand walk, `?step=` without a driver, and the exports `decodePath`, `encodeStep`, `stateAfter`, `ExploreStep` are gone.
- _(minor)_
  [user]: The Step tab's Send lists (input/effect/internal groups, "ignored in X", region lists) are gone: select an arrow and press Send in Details. Each worker keeps its row with Send buttons for the events its state handles. An event the current state does not handle can no longer be sent.
- _(minor)_
  [user]: Details show the selection's title, its doc and, for an arrow, Send; for a state, its outgoing and incoming arrows. The id, flags, region, effects, source, target and emits rows, and the Step tab's doc notes, are gone.
- _(minor)_
  [user]: The Step tab no longer shows 'Changed: keys', 'Effects started' or the free 'advance N ms' box; each timer keeps its own advance button.
- _(minor)_
  [user]: The viewer no longer draws a 'Viz: <id>' title or a machine dropdown (`heading` option removed). Next arrows are accent-coloured and still; the dashed 'reachable' box and the chip tint are gone.
  [user]: The viewer shows one machine; the `machine` option picks which (default: the first).
- _(minor)_
  [user]: systemOf, linksInside and the MachineSystem, SystemEntry, SystemLink and SystemPart types are removed; nothing in the viewer used them since the parts board went.
- _(minor)_
  [user]: Worker rows in the Step tab now pick the worker to follow instead of sending; use the arrow's Send in Details. The row Send buttons (`[data-actor] [data-send]`), the "started", "removed" and "sent" lines (`[data-live-started]`, `[data-live-removed]`, `[data-live-sent-event]`, `.explore-now`) and the Context box placeholder are gone; Context boxes show the value Send will use.
- _(minor)_
  [user]: Select any arrow in the visualizer and Details either shows Send or says in one line why it can't be sent: the walk is in another state, another part sends the event, or the guard would take the walk somewhere else.
  [user]: An arrow whose guard would land in a different state than the one drawn is now locked and says where it goes. A machine whose example values always take one branch now shows locks on the other branches; change the value in Context to try them.
- _(patch)_
  [user]: A diagram wider than its box scrolls sideways by itself when it opens and after Send, Back, Reset or a finished effect, so the current state is in view. Clicking a box or arrow still never scrolls.
- _(patch)_ [user]: a state's links in Details match the arrows drawn, and arrows found by fuzzing now look like the other arrows.
- _(patch)_
  [user]: A pool's diagram opens with its working workers in view; when the box is too narrow for them and the machine's own state, the workers come first on open and the machine's state comes first after each step.

## 0.31.0

<sub>2026-11-16</sub>

- _(minor)_
  [user]: The Controls tab, finding marks on states, coverage dimming, Full screen, the help link, hover highlights and the left-arrow key are gone; the Details tab keeps the selected arrow's Send button and its rows, and design findings stay in the gate and `mantaq-check` output.
  [user]: `<Machine>` no longer prints a design-findings line above the diagram; `failOnFindings` still fails the build.
- _(minor)_
  [user]: The Path tab (step list, Runs, Copy path), the context table, region lines, 'waiting for' and 'Nothing changed' are gone; Back and Reset undo steps, the Context tab holds the values events are sent with. `panelFooter` and `onNavigate`'s `run` are removed; `?run=` links still open a recorded run.
- _(minor)_
  [user]: The Step tab lists every child of an actor map with its own Send buttons; clicking a chip marks that child's row and clears the diagram selection. Chips no longer slide across the diagram: they show on their new state at once.
- _(minor)_
  [user]: After a Send from an arrow's Details, the Details say what was sent, with its values; the Step tab's Sent line shows the values too. An arrow selects wherever its line is clicked, dashed and dotted ones included. Teal is now in the docs legend.
- _(minor)_
  [user]: On the live page, selecting a state with the Screen tab open shows that state's screen, reached on a throwaway copy; the machine stays where it is and a line says so. Drivers may implement dryWalk(steps).
- _(patch)_ The live Step tab starts with what a Send press sent.

## 0.30.0

<sub>2026-11-16</sub>

- _(minor)_ [user]: Diagram labels sit beside their arrow at their real width, with room for the lock.
- _(minor)_
  [user]: Self-loops are nested rectangles above their state, arrows end at separate points on a state's side, and each region has its own title row.
- _(minor)_
  [user]: The diagram layout checks itself: a machine it cannot draw without overlaps shows a one-line error instead of an overlapping diagram.
- _(minor)_ [user]: Parallel arrows in a diagram keep their heads, ends and lanes 8px apart.
- _(minor)_ [user]: State names and effect chips sit 8px inside their box, with 8px between them.
- _(minor)_
  [user]: Machines whose regions talk to each other open on their diagram; the parts board, its Open/← System buttons and the "Sent by another part" Send group are gone.

  [user]: A message a machine cannot take is no longer marked with `!` on its arrow or explained in Details; the Path row and the Step tab still say it was dropped.

- _(minor)_
  [user]: `outlineOf`, `outlineChanges`, `isUnchanged` and the viewer's `changes` option are removed; the viewer no longer outlines what changed.
  [user]: The dev page no longer takes notes (right-click, `.notes.md`) or compares two designs (`?compare=`); existing `.notes.md` files are left as they are and no longer read.
- _(minor)_
  [user]: A click on a state or an arrow only selects it and shows its details; it no longer sends an event, walks to a state with Screen open, or opens a blocked note. Send from the Step tab, which no longer hides its lists in an Events and time fold.
- _(minor)_
  [user]: The selected arrow's Details has a Send button (Send RUN_SUCCEEDED to w1 for a child); a blocked arrow's Details says why. Step tab buttons read "Send <event>".
- _(minor)_
  [user]: Every child of an actor map shows as a chip with its key on the state it is in; click a chip to follow that child. The count line under the diagram is gone.
- _(patch)_ A final state's name keeps 8px clear of its inner frame, and state names keep clear of their box in the docs font.
- _(patch)_ [user]: States of an actor map leave room at the bottom for their children.

## 0.29.0

<sub>2026-11-15</sub>

- _(minor)_
  The system view names who sent each message to whom on the Path and Step tab (`orders → w1: free → working`), and marks a message its receiver had no handler for: the arrow gets a `!` after its name, the Path row starts with `!` and says `dropped`, and Details says why.

  Breaking: none. Path row text for steps that move other parts now starts those moves with the sender.

- _(minor)_
  On the live viz, clicking an event sends it at once. The Context tab sets the values events are sent with, kept in `?value=`. The payload form is gone. Breaking: none
- _(minor)_
  A machine with an actor map is drawn as one diagram: its own states and one child's, with no system board. A line under the diagram counts each map's children by state; click a count to show a child. Child pills are gone, and the harness's `children()` returns children sorted by key. Breaking: the pool and actor-map DOM loses `g.child-marker`, `g.child-dot` and `[data-open-part-tab]` for maps, and the Step tab shows one child row per map, so scripts that scraped them break.
- _(patch)_
  The Path tab has a Copy path button. A payload form now fills from what parts sent each other in the walk, so sending `ITEMS_FINISHED` by hand reports a real worker (`w1`), not `sample`. When a step changes nothing, the Step tab says so. Open receiver lands on the state the receiver is in now. The live driver records each message's payload.
- _(patch)_
  Opening a part of a machine draws only that part, with buttons to switch to the other parts. The Open buttons say "Open sender" and "Open receiver". Under Events and time, events that another part sends get their own heading. In Details, edges are titled `from —event→ to`, and the analysis and coverage rows sit in a closed fold.
- _(patch)_ The panel always sits below the graph, so the graph keeps the full width on a wide screen.
- _(patch)_ The payload form no longer offers a Values from row or sample buttons; it fills from what the walk sent.

## 0.28.0

<sub>2026-11-14</sub>

- _(minor)_
  Remove the unused `@mantaq/viz/live` page entry and `mountLive`; the Vite plugin page comes from `@mantaq/inspect`.

  Breaking: the `@mantaq/viz/live` subpath export is removed — affects code importing `@mantaq/viz/live` directly (none known). Import `mountViewer` or `mountVizText` from `@mantaq/viz/viewer` instead.

- _(minor)_
  A step the live driver reports now says who sent each message between parts, and marks one its receiver had no handler for as dropped (`message: { sender, dropped }` on `after` entries).

## 0.27.0

<sub>2026-11-14</sub>

- _(minor)_
  The system view puts a small part inside the bigger part it talks to, lists parts with no arrow to another part in a row under the board, and runs the board top to bottom on a phone.

  Breaking: none

- _(minor)_
  A factory that returns another machine next to its actor, such as a pool's inbox, now draws it as a part with arrows to and from the machine and the pool's workers. The viewer and fuzzing drive it too. Viz documents are schema 17.

  Breaking: viz document schema 16 → 17 (new required machines[].actors). Affects tools that read viz JSON from an older @mantaq/inspect; the validator refuses with "schemaVersion: expected 17, got 16": rebuild with the matching inspect.
  Breaking: a factory that returns another actor next to actor now draws it as a part. Affects factories that return a second actor (none in mantaq, justus, sandbox).

- _(patch)_ Clicking an arrow for an event that takes no data sends it at once again, even when fuzzing only recorded `{}` for it.

## 0.26.0

<sub>2026-11-13</sub>

- _(minor)_
  The live driver can try a step on a throwaway copy of the actor (`VizDriver.dryRun`) without changing the walk. Breaking: none.
- _(minor)_
  `ViewerOptions.screen` adds a first Screen tab to the live viewer, holding what the callback draws for the current state. While it is open, clicking a state walks there along the shortest walk fuzzing found. Breaking: none.
- _(patch)_ On a phone, the payload form and its focused field stay above the on-screen keyboard. Breaking: none.
- _(patch)_
  On a live diagram, an arrow whose guard the current context does not meet is drawn blocked, with a lock and the reason, and sends nothing until the context allows it. Breaking: none.

## 0.25.0

<sub>2026-11-12</sub>

- _(minor)_
  `ViewerOptions.diagramOnly` opens the viewer with only the diagram and a "Show controls" button. `<Machine diagramOnly />` (and `mountDriven({ diagramOnly: true })`) pass it on. The docs' getting-started steps, the home page, States (side by side) and the app-without-mantaq guide open this way, and step 1 no longer asks readers to ignore the tabs.
- _(minor)_ The viewer's "Coverage from" picker moves from the header into the Controls tab.
- _(minor)_
  The system view shows where work enters and one arrow each way between two parts, with the event names stacked on it. A prefix every event shares is written once under the diagram.
- _(minor)_
  A guarded arrow says when it reaches its state: step 6's `pay` arrow reads `email !== "" && items !== 0` under its name, and the green loop that fuzzing saw for the same guard is no longer drawn.
- _(minor)_
  The system view draws one dot per worker in an actor map whose workers have two states: open when free, filled when working. A key line under the diagram names the two states.
- _(minor)_
  Diagram only draws just the diagram: no finding marks or "?" hints on states, and `<Machine diagramOnly />` renders no design-findings banner. "Show controls" brings them back.
- _(minor)_
  In the live viewer, clicking an arrow for an event with data opens its form, and nothing is sent until Send. The Always ask toggle is gone. Breaking: none
- _(minor)_
  In the live viewer, a step names each effect it did not run and the events it would send ("Not run here: fetchList (it would send listFetched or fetchFailed)"). Breaking: none
- _(patch)_ The system view shrinks to fit a narrow frame, so the whole diagram stays in view instead of scrolling sideways.
- _(patch)_ In the system view, clicking the "from outside" pill sends the entry event, as its label does. Enter and Space work too.
- _(patch)_ In the system view, the "from outside" arrow now moves when its event can be sent in the current state.

## 0.24.0

<sub>2026-11-11</sub>

- _(minor)_
  Record which parts of a machine talk. `VizMachine.partOutputs` (schema 16) holds the declared outputs of each region and actor map child, and `systemOf` joins them to the parts that handle them. A step that moves other parts says so: the Path reads `team.ITEM_ARRIVED {item a}, then w1: free → working`, and the panel says `Then w1 took team.ITEMS_ASSIGNED` instead of "came back".

  Breaking: documents with `schemaVersion` 15 are refused; regenerate them. Hand-built `VizMachine` values need `partOutputs: {}`.

- _(minor)_
  The viewer opens on a system view when the parts of a machine (its regions and actor maps) send each other events: a box per part with its state, `workers ×3` with a count per state for a map, and an arrow per event between parts. A step turns the arrow that carried it pink. Click an arrow for who sends it and who takes it in which states, then Open to land on it in the part's diagram; `← System` comes back. Edges that send to another part say so in their Details.

  Breaking: a machine whose parts link now opens on the system view instead of the diagram. That affects any embed of such a machine, such as the docs' photo-upload.

## 0.23.0

<sub>2026-11-10</sub>

- _(minor)_
  The live diagram has a Controls tab with Full screen, Always ask and Diagram only. Diagram only shows just the diagram and a Show controls button.
- _(minor)_
  Breaking: removed the `@mantaq/viz/standalone` entry, `standaloneHtml` and `DOCUMENT_ELEMENT_ID`; nothing used them since the inspect CLI was removed. Use the `@mantaq/inspect` Vite plugin or `@mantaq/viz/viewer`.
- _(patch)_
  The live diagram fits its box down to about 10px labels (was 13.6px on docs pages), so wide machines no longer clip on a laptop.

## 0.22.0

<sub>2026-11-10</sub>

- _(minor)_
  Clicking an edge on the live viz fires it with a value the page already knows (what you sent before, else the first fuzz value, else the type's example). An "Always ask" toggle in the header opens the form first.

  Breaking: none

- _(minor)_
  The live driver lists children that are gone as `VizLiveState.removed`, each with the step that removed it.

  Breaking: none

- _(minor)_
  The payload form on the live viz starts at the values a click would send. "Values from" is a row of buttons (Last sent, Fuzz 1, Fuzz 2, Example, Context), a choice field of up to four options is a button row, and "Edit as JSON" is gone.

  Breaking: none

- _(minor)_
  The live viz drops its explaining text. A held effect shows as one line ("In submitting, waiting for chargeCard") and its answers are the arrows out of the state. The event lists and the time controls sit in one closed "Events and time" fold under the step line, which stays as you left it across steps and Back. The design-findings banner no longer tells you to click a `!`.

  Breaking: none

- _(minor)_
  The live viz draws each actor-map child as a marker with its key on its state; an arrow in the child graph goes to the picked child, else the one that started first. Breaking: none (map-child states draw taller, with a marker row)
- _(minor)_
  The live viz log names each child that starts, moves or is removed, in the Step tab and the Path; child rows move into Events and time.

  Breaking: none

- _(minor)_
  On the live viz, clicking an event that started a child sends the next free key, so repeated adds start new children; a field's @example comes before fuzz values.

  Breaking: none

- _(minor)_
  Viewer text, lines and controls are black and white; colour appears only on graph highlights.

  Breaking: `--accent` no longer colours controls (they use `--fg`). Themed embeds should also map the new `--select`, `--grid` and `--shadow` variables.

- _(patch)_
  The live page no longer scrolls when an edge is clicked, drops the "save as journey" box, and shows real buttons with a single filled Send.

  Breaking: none

- _(patch)_
  Embeds (the Astro `<Machine>`) no longer pull in the standalone page's body style, which set the host page's text to 14px.

  Breaking: none

- _(patch)_ Added states in compare mode are now blue instead of purple.
- _(patch)_
  Self-transitions on one state draw as separate nested loops with their labels above them and a smaller arrowhead pointing into the state; the start marker is bigger.
- _(patch)_ Viewer header, tabs and controls follow the host page's font size.
- _(patch)_
  Self-transition loops get small arrowheads in the loop's colour, and nested loops sit further apart so labels do not overlap.

## 0.21.0

<sub>2026-11-08</sub>

- _(minor)_
  A live step lists the outputs the machine sent out, as "Sent out: …", and names where the app takes each one when the page passes `routes` to the viewer. Breaking: `VizLiveStep.sent` is now required, so a hand-written `VizDriver` must fill it (`[]` when nothing was sent).

## 0.20.1

<sub>2026-11-08</sub>

- _(patch)_
  The payload form starts from values sent earlier in the walk, and the Values from picker appears only when there is a real choice.

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

## 0.18.0

<sub>2026-11-08</sub>

- _(minor)_
  Breaking: region dead ends and unreachable region states are now design findings. The live viewer shows each region's state, groups the Send buttons per region and sends them to that region, and draws a start arrow for each region.
- _(minor)_ The payload form offers fuzzed payloads under Values from, and Edit as JSON.
- _(minor)_
  The payload form is a sheet pinned to the bottom of the viewer: Send is always on screen. The popover on the diagram is gone, along with its `.payload-popover` CSS class and its placement; the sheet uses `.payload-sheet`, and the event's edge gets `data-composing`. Styles that targeted `.payload-popover` need to move to `.payload-sheet`.

## 0.17.0

<sub>2026-11-08</sub>

- _(minor)_
  The live driver holds effects: they do not run, and `VizLiveState.waiting` names the ones waiting for an answer. `createDriver(target, { effectMode: "real" })` runs them.

  Breaking: createDriver holds effects by default — affects code calling @mantaq/inspect/drive directly (none found in mantaq apps or justus); pass { effectMode: "real" } to keep running them.

  Breaking: VizLiveState has required effectMode and waiting — affects custom VizDriver implementations (none known).

- _(minor)_
  Design findings say what is wrong in the machine's own names: a headline, a proof (for an unreachable state, the arrows into it and the states the machine can reach) and a fix. A declared input or internal event that no state handles is now a finding. Naming notes (vague or undocumented names) are flagged as notes.

  Breaking: `VizFinding.state` is nullable, and `title`, `proof`, `fix`, `event`, `note` and `noReplay` are new required fields — affects code reading `@mantaq/viz` findings. A declared input or internal event that no state handles is now a design finding — affects `expectNoDesignErrors` and `failOnFindings` on such machines.

- _(minor)_
  The diagram panel shows each finding as a card: the headline first, then the proof, the fix, and Replay (labelled for what it shows) or the reason there is nothing to replay. Clicking the ! on a state brings its first finding into view. Naming notes sit under "Naming notes" and no longer put a ! on the diagram; findings about the whole machine show at the top of the Details tab.

  Breaking: `FINDING_KINDS` is removed from `@mantaq/viz` — read `title`, `proof` and `fix` from each finding instead.

- _(minor)_
  A step can name the region it goes to (`actor: { region }`), in the live driver, the fuzzer, saved journeys and shared links (`upload>photoPicked`). Each region's start state is marked `initial`, and `VizLiveState.regions` lists where every region is.

  Breaking: document format v14 — affects anyone serving a prebuilt viz.json; rebuild it.

  Breaking: VizLiveState has a required regions and VizLiveOutcome gains "missing" — affects custom VizDriver implementations and exhaustive switches on the outcome (none known).

- _(minor)_
  The live panel shows each held effect first, as **Waiting for**, with the events it reports. The panel text says what runs.

  Breaking: the live page and Astro embeds no longer run effects — affects people who relied on effects answering by themselves in the viz (e.g. justus flows pages); they now pick the answer. Recorded runs replay unchanged.

## 0.16.0

<sub>2026-11-08</sub>

- _(minor)_
  The live driver reports the current state's payload as `VizLiveState.payload`. Breaking: a custom `VizDriver` must return `payload`.
- _(minor)_
  The payload form starts filled from same-named fields of the state's payload or context; Values from offers the other matches.

## 0.15.0

<sub>2026-11-07</sub>

- _(minor)_
  Breaking: viz documents are version 13. `VizFuzz.expectations` lists every rule the machine file writes (`neverSee` and `mustSee`) with `held`, whether fuzzing kept it; `failedExpectations` still lists the ones that broke. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.
- _(minor)_ A state's details panel lists the rules the machine file writes for it, under Rules, with whether fuzzing kept each one.

## 0.14.0

<sub>2026-11-07</sub>

- _(minor)_
  The viewer takes `changes: { machine, before, onSeen }`: it outlines states and arrows added since `before` and lists what was added and removed, with a Mark as seen button. New `outlineOf`, `outlineChanges`, `isUnchanged`. Breaking: none.

## 0.13.0

<sub>2026-11-07</sub>

- _(minor)_
  Live panel: next events are grouped like the static walk (Send an input, Effect reports back, Other internal events), with the effect each report comes from and its handler's doc, and the state's effects with their unhandled reports. Answer for a running effect by picking what it reports. Breaking: the live "Send an event" heading and `data-group="live"` list are gone; `[data-send]` and `[data-send-item]` are unchanged.

## 0.12.0

<sub>2026-11-07</sub>

- _(minor)_
  Design findings: a state or event whose name is only generic status words (ok, loading, done, ...) or that has no doc comment is reported when the machine file is read. Breaking: pages and `expectNoDesignErrors` with `source` can report new findings; `VizFindingKind` gains `vagueName` and `undocumented`.

## 0.11.0

<sub>2026-11-07</sub>

- _(minor)_
  The live panel asks for an event's declared payload fields (a dropdown for a fixed set of values, a number box, a text box, one input per field, already filled in), lists the machine's context fields with their meaning and current value on the Context tab, and says at the top what runs in the browser.
- _(minor)_
  After an event, the live panel says what ran: what happened, the condition that decided it, the context fields that changed and the effects started. Results an effect sends back later show up on their own. Breaking: `VizLiveState` gains `after`; a hand-written `VizDriver` must fill it (it may also add `listen`). No known drivers outside `@mantaq/inspect`.

## 0.10.0

<sub>2026-11-07</sub>

- _(minor)_
  The viewer takes `panelFooter(selection)`: content under the panel tabs for the selected state or edge. ArrowLeft no longer steps back while typing in a text field. Breaking: none.
- _(minor)_
  Breaking: viz documents are version 12. `VizEvent.payloadType` is replaced by `payload` (the fields of the event's payload type, read from the types and their JSDoc), and `VizMachine.context` lists the fields of the actor's context type. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.

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
