# Designing with the live page

Design a machine by editing its real file while the live viz page shows the result. Signatures: check the installed types.

## First reply to a design ask

Someone asks you to design, plan or rethink a feature or a rule ("design this with me", "who can delete photos?"). Your first reply is the drawn design, never a written design and never only questions.

- Write the machine (section 1, or section 2 for a change) and one recorded walk per story the ask names (section 6). Do it before you ask anything.
- The ask changes something the app already does (section 2 found its machines): the reply you give the user (not a mid-run status) starts with a `Today:` block, before any link to your change: one line per story the ask names, each a full URL (section 3) to its recorded walk on the machines the app runs, with the real `run=` title copied from the machine's `__runs__` JSON. Never `run=…`, a bare title, or prose in place of the link. Links to a branch or pull request preview are the change: list them after the `Today:` block, never in it. Then the drawn change. A story with no walk of today: record one on the real machine first (section 6). This is the default, not a gate: do not wait for an answer before drawing the change.
- The `Today:` block belongs to your FINAL answer to the person, the last message they read, not only the first one. When you handed work to a subagent or helper, the lead still opens its final answer with the `Today:` block (real flows-site `run=` links for each machine touched, pasted from the helper's result or recorded by you), before any finding, summary or link to your change. Before sending the final answer, check its first line is `Today:`; if a helper wrote the findings, rewrite the answer around the `Today:` block. Start a helper only after you have the walks, or tell it to return them. A final answer that opens with findings, a diff summary or a preview link is wrong: move the `Today:` block to the top.
- Reply with one preview link per walk (section 3). If the repo's flow docs say a design ask gets a preview, push and open the draft pull request without asking.
- Open questions go after the links, as questions about the drawn machine. This is the default, not a gate: when the ask names no feature at all, one question first is fine.

## 0. Set up (no mantaq or no live page yet)

Skip what is already there: `@mantaq/core` in package.json, `mantaqViz` in the vite config.

1. Vite only. No `vite` in package.json: say the live viewer runs on Vite and ask before adding it. A user who asked for a clickable diagram has consented.
   - Empty folder: `npm create vite@latest . -- --template vanilla-ts`. Its tsconfig includes only `src`: add `vite.config.ts` to `include`, or step 6 skips the config and a mistyped `mantaqViz` option passes.
   - Bare `npm init` project (CommonJS, so Vite warns "ESM syntax in a file loaded as CommonJS"): `npm pkg set type=module`, `npm i -D vite typescript`, and a `tsconfig.json` with `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"include": ["src", "vite.config.ts"]`.
2. Use the project's package manager.
3. Install `@mantaq/core` and `-D @mantaq/inspect`, no versions. Check one core with `npm ls @mantaq/core`. Two versions: install core at the version `@mantaq/inspect` depends on. A timer or a promise effect (`withTimeout`, `withPromise`) also needs `@mantaq/sugar`.
4. Vite config. None: create `vite.config.ts`:

   ```ts
   import { defineConfig } from "vite";
   import { mantaqViz } from "@mantaq/inspect/vite";

   export default defineConfig({
     plugins: [mantaqViz({ machines: "src/**/*.machine.ts" })],
   });
   ```

   One exists: add the import and the plugin to `plugins`, change nothing else. Machines kept elsewhere: change the glob to match.

5. Machine file `src/<name>.machine.ts`. Export a machine, not an actor: `export const <name> = machine("<name>", { create })`. The string is the id the page and links use. No timers: `create` takes no clock. Ports (I/O) are options of `create`, each with a working default, so the page can build it:

   ```ts
   import { Actor, event, machine, state } from "@mantaq/core";

   /** The invite was sent and nobody has answered. */
   const waitingForAnswer = state("waitingForAnswer")();
   /** The invitee said yes. */
   const accepted = state("accepted")().final();
   /** The invitee follows the link. */
   const accept = event("ACCEPT")();

   export const invite = machine("invite", {
     create: ({ log = console.log }: { log?: (line: string) => void }) =>
       Actor({
         inputs: [accept],
         states: [waitingForAnswer, accepted],
         initial: waitingForAnswer,
         setup: (m) => {
           /** The invitee follows the link. */
           m.on(waitingForAnswer, {
             event: accept,
             to: [accepted],
             handler: () => {
               log("accepted");
               return { state: accepted };
             },
           });
         },
       }),
   });
   ```

   A timer: `create: ({ clock }) => Actor({ clock, … })`; the effect reads it from its `input`:

   ```ts
   import { Actor, event, machine, state } from "@mantaq/core";
   import { withTimeout } from "@mantaq/sugar";

   /** The invite was sent and nobody has answered. */
   const waitingForAnswer = state("waitingForAnswer")();
   /** Nobody answered in time. */
   const expired = state("expired")().final();
   /** The 15 minutes ran out. */
   const waitedTooLong = event("WAITED_TOO_LONG")();

   export const timedInvite = machine("timedInvite", {
     create: ({ clock }) =>
       Actor({
         clock,
         inputs: [],
         internal: [waitedTooLong],
         states: [waitingForAnswer, expired],
         initial: waitingForAnswer,
         setup: (m) => {
           /** Nobody answered: the invite expires. */
           m.on(waitingForAnswer, {
             event: waitedTooLong,
             to: [expired],
             handler: () => ({ state: expired }),
           });
           /** Gives the invitee 15 minutes. */
           m.effect(waitingForAnswer, {
             name: "answerDeadline",
             sends: [waitedTooLong],
             fn: (input) => withTimeout(900_000, { input, event: () => waitedTooLong.create() }),
           });
         },
       }),
   });
   ```

   States, events and JSDoc as in sections 4 and 5.

6. Typecheck: `npx tsc --noEmit` (or the repo's script). Fix against the types.
7. Start the server in the background: `npx vite`. Read its output for the `Local:` URL and `mantaq viz: /__mantaq/`.
8. Check it is drawn: `curl -s <Local URL>__mantaq/viz.json | grep -c '"id": "<id>"'` is at least 1. This request builds the page, so read the server output again: any `[mantaq-viz]` line is a problem to fix.
9. Reply with the link `<Local URL>__mantaq/?machine=<id>` and the states in one line. Leave the server running while the user designs.

## 1. The machine in the code is the design

Edit the real machine file and fix every caller the typechecker flags. Never make a sketch copy or a second file for the same machine, unless the user asks for two designs (section 10).

## 2. Find the machine from plain words

List machine files: `rg -l "machine\(" -g '*.ts' -g '!*.test.ts'`, plus any flows manifest. Read each candidate's top JSDoc and its state and event names. Match them to the user's words and the repo glossary (`CONTEXT.md` if present). One match: name it. Several: list them, one line each, and ask one question. None: design a new one, starting with states. A machine no app code builds (`rg -l "<export name>.create\(" -g '!*.test.ts'` lists nothing) is a design, not how the app works today: never link its walks as today, and say so when it is the only machine for a story.

## 3. Open the live page

Find the repo's live-page command: `rg -l mantaqViz` across scripts, vite configs and package scripts. Prefer a script that takes a file argument. Start it as a background process, read its output for the URL line and `[mantaq-viz]` warnings, and give the link with `?machine=<id>`. The id is the string in `machine("<id>", …)`: read it from the file. Stop the server when the design work ends.

A published flow page is an Astro page with `<Machine src="…" />` (`mantaqViz` from `@mantaq/inspect/astro` in `astro.config`); link it with `?machine=<id>`. The live dev page stays the edit loop. After `astro build`, run `mantaq-check-site <outDir> --base <base>`; it fails naming the page and machine. To show a journey, link its recorded run: `?machine=<id>&run=<run name>`, URL-encoded (`encodeURIComponent`), with the name exactly as in `__runs__/*.json`. A story with two people (Maya asks, Nils accepts) is one run per person's machine: a top-level test, titled exactly the story, in a test file next to each machine (the page reads runs only from the `__runs__` folder next to the machine). Link it once, naming every side: `?machine=<a>&machine=<b>&run=<story>`; each viewer opens on its own run. The page must hold all of them: add the missing `<Machine>` if not. Name a run only for what its own steps show. If a person's side is app code, not a machine, say so in the reply and name the file: the page cannot show it. Needs `@mantaq/inspect` 0.23 or later; older pages open only the first machine. For a change ask, the walks that open the reply are today's: take them from the default branch's `__runs__`, not from a draft pull request you opened or found. Never put a `step=` trace in docs, issues or PRs. It is unreadable, breaks on any rename, and cannot carry the result of an async effect. Needs `@mantaq/viz` 0.6 or later; older pages ignore `run=`.

A localhost link opens only on the machine running the server. If the user is elsewhere, or asked for a link to judge or share, look for hosted previews in the repo's flow or contributing docs. If there is one, ask before pushing (unless they asked for a shareable link), push a branch, open a draft pull request, and wait until the preview names your commit. Then reply with one preview link per journey (`?machine=<id>&run=<run name>`). With no preview, say the link only opens here, and give the published URL it will have after merge.

No live page in the repo: add `mantaqViz({ machines })` per the `@mantaq/inspect` README and say so. The page only drives an exported `machine(...)`. Ports (I/O) stay optional options of `create` with a working default, so the page can build the actor. See the mantaq guide "Machines in an application".

## 4. Make the page readable without code

- Every state, event, `m.on` / `m.onAny` and `m.effect` gets a one-sentence JSDoc in domain words.
- Every handler declares `to`. Every effect declares `sends`.
- One `m.on` per state, not an `onAny` that branches on state: the diagram cannot draw it.

<!-- docs-check: skip -->

```ts
/** The invite was sent and nobody has answered. */
const waitingForAnswer = state("waitingForAnswer")();

/** The invitee follows the link. */
m.on(waitingForAnswer, { event: accept, to: [accepted], handler: () => ({ state: accepted }) });
```

## 5. Supported order, not a rule

States, then edges, then runs. Follow the user's order. Write each step into the file as you go. Unreachable states while shaping are expected.

## 6. Runs

Each test builds the actor through `recordRuns(<machine>)` (`@mantaq/inspect/record`), then `make.create()`. Name tests as user-visible journeys: the name is the run's label. Run the whole test file after each change to refresh `__runs__`. A journey linked from docs is a top-level test (no `describe`), so the run name is its title. Pass `{ clock }` only for a timed machine, as the page does. A journey through an effect's answer (photos loaded, the delete failed) sends the event that starts the effect, then injects the answer at once: `actor.inject({ type: "<answer event>", payload })`, no `await` between, then `await actor.settled()`. This works when the machine's default port is the real backend, which never answers in a test or on the page: keep that default, never change a production default to record a walk, and never skip the walk. A recorded test that passes options besides `clock` is replayed on the defaults and fails with `recordRuns: run "..." dropped:` when it ends elsewhere. Needs `@mantaq/core` 0.7.1 or later; with older core, `settled()` waits forever for the left state's call. A test that is not a journey builds its actor with the machine itself, not through `recordRuns`.

The page fuzzes each machine on a budget and warns on states it never reached. A deep state at 0 hits is a budget miss, not proof it is unreachable: raise `fuzz: { timeLimitMs }` or `fuzz: { iterations }` in `mantaqViz` (or `expectNoDesignErrors`), or add a test journey that reaches it (a named run in `tests`).

## 7. Each turn

Edit, save, run the test file, then reply in at most 3 lines: changed states and edges, failing checks. No code unless asked.

## 8. Done checks and report

- The repo's typecheck passes.
- A test next to the machine's tests calls `expectNoDesignErrors({ machine: <name>, source })`. If it stops with `fuzzing had no payload for ...`, add `source` or `payloads` for the events it names; do not change the design to get past it. When machines talk, also call it on the machine that builds, wires and returns them together (`return { actor: checkout, payment }` inside `create`), so a message the receiver handles in no state fails. A lost message also prints `on the board: ?machine=<id>&run=<name>`: put it after the page address in your report so the user sees the `!` row.
- The test file passes with `CI=1` and the server output has no `dropped:` warning.
- Report: the machine file, states and edges in one line each, runs, and one `?machine=&run=` link per journey, on the preview when there is one.

## 9. Changing a singleton

If the machine is a built instance, offer to wrap it in `machine(...)` first (one change, its own step), then continue.

## 10. Two designs

Only when the user asks for two designs, two ways or alternatives. Otherwise section 1 holds. A change inside one machine: steps 1-7. A change across machines (it touches a wire or two or more machines): "Across machines" below.

1. Files: `<feature>.design-a.machine.ts` and `<feature>.design-b.machine.ts`, next to where the real machine lives or will live. Export `<feature>DraftA = machine("<feature>DraftA", …)` and `<feature>DraftB = machine("<feature>DraftB", …)`. Changing an existing machine: both drafts start as copies of it, and the real file stays untouched until the pick. No tests for one-machine drafts.
2. Two real designs, equal effort, that differ in a decision the user cares about (who approves, what happens on expiry). Use the same state and event names wherever the domain is the same, so the user compares decisions, not names. JSDoc on both, as in section 4. Never recommend one unless asked.
3. Serve both: pass both files to the repo's live-page script, or check that the `machines` glob matches them (widen the glob; do not move the files).
4. Before sending the link: the typecheck passes, the server output has no `[mantaq-viz]` line for either file, and `curl -s <Local URL>__mantaq/viz.json` lists both ids. Otherwise fix first.
5. Reply in at most 4 lines: `Two drafts ready, both typecheck.`, then one line per design (`A (<what it chooses>): <n> states, <m> edges.`), then one link each: `<Local URL>__mantaq/?machine=<feature>DraftA` and `<Local URL>__mantaq/?machine=<feature>DraftB`.
6. Feedback on one design: edit that draft; the page redraws.
7. The pick ("keep A", "the first"): move the kept draft into the real machine file (existing feature) or a new file named the repo's way (new feature), rename the export to the real name, fix every caller the typechecker flags, delete both draft files, then run the section 8 checks. Reply in at most 3 lines: the file, the checks that passed, and `<Local URL>__mantaq/?machine=<id>`. If the pick is unclear, ask one question. If the user drops both, delete the drafts and say so in one line. Never leave a draft file behind.

### Across machines

The user compares two whole apps, so each design is a copy of the root that builds every machine (section 11), with its changes in place.

1. Files per design (A shown; B the same with `b`/`B`). Real files stay untouched until the pick.
   - Root: copy the root file to `<root file>.design-a.ts`, export `<root>DraftA = machine("<root>DraftA", …)`.
   - Each machine the design changes or adds: copy its file to `<file>.design-a.ts` (`<name>.design-a.machine.ts` when the real one ends `.machine.ts`), export `<name>DraftA`, build it in the draft root instead of the real one. A wire the design changes: copy the wire function into the draft root and call the copy.
   - The draft root returns each changed or added machine under its key plus the letter (`uploader` becomes `uploaderA`); the rest keep their keys. Boxes and Step text use these keys, so the user finds the change by its letter.
   - No draft name may end like the repo's real machine files (a test may count them).
2. One walk per design: `<root file>.design-a.test.ts`, one top-level test through `recordRuns(<root>DraftA)`, titled the same in A and B with the story the ask names. Same events where the domain is the same; each asserts where its own design ends. The one exception to "No tests for drafts"; deleted at the pick. Run it once to record it.
3. Two real designs, equal effort, as in the one-machine step 2. A design finding in a draft is a mistake: fix it. A walk that still fails is a fact: report it, never weaken or shorten it.
4. One page for both: a page with one `<Machine src>` per draft root, no `run` prop (a failed walk would break the build), each under a heading `A: <what it chooses>` / `B: …` in plain words. Where it goes: the repo's flow docs. `<page URL>?machine=<root>DraftA&machine=<root>DraftB&run=<story>` opens both, one under the other, each on its walk.
5. Before sending: typecheck passes; both walks pass, or the failing one is reported; the page builds with no finding and holds both roots.
6. Reply: the `Today:` block ("First reply"), then at most 5 lines:
   `Two designs of <the ask>, both typecheck. Changed machines end in A or B.`
   `A (<what it chooses>): changes <keys>. Walk "<story>" ends with <where>. <link>`
   `B (<what it chooses>): changes <keys>. Walk "<story>" ends with <where>. <link>`
   `Both, one under the other: <link>`
   A design's link is `<page URL>?machine=<root>DraftA&run=<story>`. Never recommend one.
7. The pick ("B"):
   - Rebase on the default branch. Move each B machine draft into its real file with the real export and id. Apply the draft root's differences (keys without the letter, wires, added machines) to the real root by hand; never copy the draft root over it.
   - Move B's walk into the real root's walk test file: a top-level test through its `recordRuns`, after the existing tests, real keys. Run the file to record it. This walk stays.
   - Delete every draft file of A and B, both draft walk tests and their `__runs__` files, the page and its entries.
   - Run section 8's checks and every test file that imports the real root.
   - `git status --short` and `rg -l "DraftA|DraftB|design-a|design-b"` list nothing; only then reply in at most 3 lines: files changed, checks passed, `Left behind: nothing.`, and the real root's link with `run=<story>`.

## 11. Machines that talk

Two or more machines that send each other messages ("a checkout, and a stock service that holds the item"):

- One machine, named for the one the person starts with (`checkout` in `src/checkout.machine.ts`), builds every machine inside `create`, wires them, and returns them together: `return { actor: checkout, stock }`. Each timed actor gets the same `clock`; a timeless one gets none. The page draws `stock` as a shaded box and each message as a dotted line; the link stays `?machine=checkout`.
- Event names are unique across the machines (`HOLD_ITEM`, `ITEM_HELD`; never a `DONE` in both), so the page names the right sender.
- A message is an output of the sender and an input of the receiver. Wire each one with `onOutput`, typed, no cast; a message with a payload passes it on with `x.create(out.payload)`:

<!-- docs-check: skip -->

```ts
onOutput(checkout, (out) => {
  if (holdItem.is(out)) stock.send(holdItem.create());
  if (itemSold.is(out)) stock.send(itemSold.create());
  if (releaseItem.is(out)) stock.send(releaseItem.create());
});
onOutput(stock, (out) => {
  if (itemHeld.is(out)) checkout.send(itemHeld.create());
});
return { actor: checkout, stock };
```

- Tests: section 8's design check on this machine, and one recorded walk that crosses: send the first event to `actor` and expect the other machine's state (`expect(made.stock.state.name).toBe("holding")`). The design check passes when nothing is wired; only the walk shows the wire works.
- Reply: the link, one line of states per machine, and what the design check caught and you fixed, if anything.

Full example: https://github.com/AndersCan/mantaq/blob/main/apps/docs/src/design/talking-machines.ts
