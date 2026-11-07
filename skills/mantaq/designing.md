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

Edit the real machine file and fix every caller the typechecker flags. Never make a sketch copy or a second file for the same machine.

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
const pending = state("pending")();

/** The invitee follows the link. */
m.on(pending, { event: accept, to: [accepted], handler: () => ({ state: accepted }) });
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
