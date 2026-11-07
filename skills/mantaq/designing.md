# Designing with the live page

Design a machine by editing its real file while the live viz page shows the result. Signatures: check the installed types.

## 0. Set up (no mantaq or no live page yet)

Skip what is already there: `@mantaq/core` in package.json, `mantaqViz` in the vite config.

1. Vite only. No `vite` in package.json: say the live viewer runs on Vite and ask before adding it. A user who asked for a clickable diagram has consented.
   - Empty folder: `npm create vite@latest . -- --template vanilla-ts`. Its tsconfig includes only `src`: add `vite.config.ts` to `include`.
   - Bare `npm init` project (CommonJS, so Vite warns "ESM syntax in a file loaded as CommonJS"): `npm pkg set type=module`, `npm i -D vite typescript`, and a `tsconfig.json` with `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"include": ["src", "vite.config.ts"]`.
2. Use the project's package manager.
3. Install `@mantaq/core` and `-D @mantaq/inspect`, no versions. Check one core with `npm ls @mantaq/core`. Two versions: install core at the version `@mantaq/inspect` depends on.
4. Vite config. None: create `vite.config.ts`:

   ```ts
   import { defineConfig } from "vite";
   import { mantaqViz } from "@mantaq/inspect/vite";

   export default defineConfig({
     plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })],
   });
   ```

   One exists: add the import and the plugin to `plugins`, change nothing else. Machines kept elsewhere: change the glob to match.

5. Machine file `src/<name>.machine.ts`. Export a factory, not an instance: `export function create<Name>({ clock }: { clock: Clock } = { clock: VirtualClock() })` returning `Actor({ ..., clock, ... })`. Ports go in the same options object, each with a working default. States, events and JSDoc as in sections 4 and 5.
6. Typecheck: `npx tsc --noEmit` (or the repo's script). Fix against the types.
7. Start the server in the background: `npx vite --open "/__mantaq/?machine=<id>"`. Read the output: the `Local:` URL and `mantaq viz: /__mantaq/`. Any `[mantaq-viz]` line is a problem to fix.
8. Check it is drawn: `curl -s <Local URL>__mantaq/viz.json | grep -c '"id": "<id>"'` is at least 1.
9. Reply with the link `<Local URL>__mantaq/?machine=<id>` and the states in one line. Leave the server running while the user designs.

## 1. The machine in the code is the design

Edit the real machine file and fix every caller the typechecker flags. Never make a sketch copy or a second file for the same machine, unless the user asks for two designs (section 10).

## 2. Find the machine from plain words

List machine files: `rg -l "Actor\(" -g '*.ts' -g '!*.test.ts'`, plus any flows manifest. Read each candidate's top JSDoc and its state and event names. Match them to the user's words and the repo glossary (`CONTEXT.md` if present). One match: name it. Several: list them, one line each, and ask one question. None: design a new one, starting with states.

## 3. Open the live page

Find the repo's live-page command: `rg -l mantaqViz` across scripts, vite configs and package scripts. Prefer a script that takes a file argument. Start it as a background process, read its output for the URL line and `[mantaq-viz]` warnings, and give the link with `?machine=<id>`. The id is the export name minus `create`/`Actor`, first letter lowercased. Stop the server when the design work ends.

A published flow page is an Astro page with `<Machine src="…" />` (`mantaqViz` from `@mantaq/inspect/astro` in `astro.config`); link it with `?machine=<id>`. The live dev page stays the edit loop. To show a journey, link its recorded run: `?machine=<id>&run=<run name>`, URL-encoded (`encodeURIComponent`), with the name exactly as in `__runs__/*.json`. Never put a `step=` trace in docs, issues or PRs. It is unreadable, breaks on any rename, and cannot carry the result of an async effect. Needs `@mantaq/viz` 0.6 or later; older pages ignore `run=`.

No live page in the repo: add `mantaqViz({ machines })` per the `@mantaq/inspect` README and say so. The page only drives an exported factory that takes `{ clock }` or a clock. Ports (I/O) stay optional options with a working default, so the page can build the actor. See the mantaq guide "Machines in an application".

## 4. Make the page readable without code

- Every state, event, `m.on` / `m.onAny` and `m.effect` gets a one-sentence JSDoc in domain words.
- Every handler declares `to`. Every effect declares `sends`.
- One `m.on` per state, not an `onAny` that branches on state: the diagram cannot draw it.

```ts
/** The invite was sent and nobody has answered. */
const waitingForAnswer = state("waitingForAnswer")();

/** The invitee follows the link. */
m.on(waitingForAnswer, { event: accept, to: [accepted], handler: () => ({ state: accepted }) });
```

## 5. Supported order, not a rule

States, then edges, then runs. Follow the user's order. Write each step into the file as you go. Unreachable states while shaping are expected.

## 6. Runs

Each test builds the actor through `recordRuns(factory)` (`@mantaq/inspect/record`). Name tests as user-visible journeys: the name is the run's label. Run the whole test file after each change so the Runs list updates. A journey linked from docs is a top-level test (no `describe`), so the run name is its title. Build it with only `{ clock }`, as the page does, so it replays the same there.

The page fuzzes each machine on a budget and warns on states it never reached. A deep state at 0 hits is a budget miss, not proof it is unreachable: raise `fuzz: { timeLimitMs }` or `fuzz: { iterations }` in `mantaqViz` (or `expectNoDesignErrors`), or add a test journey that reaches it (a named run in `tests`).

## 7. Each turn

Edit, save, run the test file, then reply in at most 3 lines: changed states and edges, failing checks. No code unless asked.

## 8. Done checks and report

- The repo's typecheck passes.
- A test next to the machine's tests calls `expectNoDesignErrors({ id, create: () => factory({ clock: VirtualClock() }) })`.
- The test file passes with `CI=1` and the server output has no `dropped:` warning.
- Report: the machine file, states and edges in one line each, runs, and one `?machine=&run=` link per journey.

## 9. Changing a singleton

If the machine is a built instance, offer to convert it to an exported factory first (one change, its own step), then continue.

## 10. Two designs, side by side

Only when the user asks for two designs or alternatives. Otherwise section 1 holds.

1. Files: `<feature>.design-a.machine.ts` and `<feature>.design-b.machine.ts`, next to where the real machine lives or will live. Export `create<Feature>DraftAActor` and `create<Feature>DraftBActor`, so the ids are `<feature>DraftA` and `<feature>DraftB`. Changing an existing machine: both drafts start as copies of it, and the real file stays untouched until the pick. No tests for drafts.
2. Two real designs, equal effort, that differ in a decision the user cares about (who approves, what happens on expiry). Use the same state and event names wherever the domain is the same, so the user compares decisions, not names. JSDoc on both, as in section 4. Never recommend one unless asked.
3. Serve both: pass both files to the repo's live-page script, or check that the `machines` glob matches them (widen the glob; do not move the files).
4. Before sending the link: the typecheck passes, the server output has no `[mantaq-viz]` line for either file, and `curl -s <Local URL>__mantaq/viz.json` lists both ids. Otherwise fix first.
5. Reply in at most 4 lines: `Two drafts ready, both typecheck.`, then one line per design (`A (<what it chooses>): <n> states, <m> edges.`), then `Compare: <Local URL>__mantaq/?machine=<feature>DraftA&compare=<feature>DraftB`. Needs `@mantaq/inspect` 0.10 or later; older pages ignore `compare=` and show design A only.
6. Feedback on one design: edit that draft. The page redraws and keeps both walks.
7. The pick ("keep A", "the first"): move the kept draft into the real machine file (existing feature) or a new file named the repo's way (new feature), rename the export to the real name, fix every caller the typechecker flags, delete both draft files, then run the section 8 checks. Reply in at most 3 lines: the file, the checks that passed, and `<Local URL>__mantaq/?machine=<id>`. If the pick is unclear, ask one question. If the user drops both, delete the drafts and say so in one line. Never leave a draft file behind.

## 11. Notes from the live page

On the dev server the user can click a state or an arrow and write a note. Notes for a machine file are in the file next to it with `.notes.md` in place of the extension (`checkout.machine.ts` → `checkout.machine.notes.md`). Needs the `@mantaq/inspect` release that ships this section.

When the user says "apply the viz notes" (or "the notes"):

1. Find them: `rg -l "^mantaq notes v1" -g '*.notes.md'`. Read every item with `status: open`. Skip `done`.
2. `on:` names a state (`on: state paymentPending`) or an arrow by its source state and event (`on: edge paymentPending CANCEL`). `machine:` is the machine id. An arrow note is about the handler for that event in that state (`m.on(paymentPending, { event: CANCEL })`; source `*` or `<region>.*` is `m.onAny({ event: CANCEL })`): change that handler and what it needs, nothing else. One handler can draw several arrows; if the note does not say which outcome it means, ask. A note on a state may ask for a change near it: "needs a cancel" means a new edge out of that state.
3. Change the real machine file (section 1), with JSDoc as in section 4. Two notes that contradict each other: apply neither and ask which one.
4. Run the section 8 checks.
5. Then, for each note you applied, change `status: open` to `status: done` and add one line under it: `  result: <what changed, one line>`. Not sure what a note means: leave it open, add `  question: <one question>`, and ask the same question in chat.
6. Renamed or removed a state or an event: update every `on:` line that names it (`state <id>` and both parts of `edge <from> <event>`), done notes too.
7. Never delete a note, never change its `id:`, `machine:` or `note:` lines, never add a note. Keep one field per line with the two-space indent.
8. Reply with one line per note: `<id> <on>: <what changed>. done` or `<id> <on>: asked "<question>"`. The page redraws and shows each note as Done.
