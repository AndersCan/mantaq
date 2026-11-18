# Testing Mantaq

Deterministic tests with the VirtualClock + vitest. Harness and coverage from `@mantaq/test` (`npm install @mantaq/test`) and `@mantaq/traversal`. Check exact signatures against the installed types.

## Deterministic Tests (VirtualClock)

Never real timers in tests. A machine with timers gets a `VirtualClock` from `create({ clock })`; jump with `advance`. A timeless machine is built with `create()`.

```ts
import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";
import { matches, withTimeout } from "@mantaq/sugar";
import { expect, test } from "vitest";

const submit = event("SUBMIT")();
const submitDone = event("SUBMIT_DONE")();
const fillingForm = state("fillingForm")();
const submitting = state("submitting")();
const submitted = state("submitted")().final();

const form = machine("form", {
  create: ({ clock }) =>
    Actor({
      clock,
      inputs: [submit],
      internal: [submitDone],
      states: [fillingForm, submitting, submitted],
      initial: fillingForm,
      setup: (m) => {
        m.on(fillingForm, {
          event: submit,
          to: [submitting],
          handler: () => ({ state: submitting }),
        });
        m.on(submitting, {
          event: submitDone,
          to: [submitted],
          handler: () => ({ state: submitted }),
        });
        m.effect(submitting, {
          name: "submitDelay",
          sends: [submitDone],
          fn: (input) => withTimeout(800, { input, event: () => submitDone.create() }),
        });
      },
    }),
});

test("the form submits after 800ms", () => {
  const clock = VirtualClock();
  const actor = form.create({ clock });

  actor.send(submit.create());
  clock.advance(800); // fires timers, drains queue — synchronous
  expect(matches(actor, "submitted")).toBe(true);
});
```

No awaits needed for timer work. For promise-based effects, `await actor.settled()`. Pending timers are not queued events, so `settled()` does not advance time. It does not wait for an effect whose state was left (aborted on exit), so a walk that injects an effect's answer can await it even when the real call never answers.

Assert no leaked timers at the end of a test with the clock's pending-timer inspection (`hasPending`, `pendingTimers`).

## Failure-Path Injection

`actor.send()` only accepts declared input events. To exercise an error branch, inject an internal event by id through the harness's `send` (or the actor's `inject`):

<!-- docs-check: skip -->

```ts
import { createTestHarness } from "@mantaq/test";

const h = createTestHarness(actor);
h.send({ type: "CONNECTION_FAILED" });
clock.advance(2000);
expect(matches(actor, "reconnecting")).toBe(true);
```

Use this for internal failure events (`PAYMENT_FAILED`, timeouts, retries) without forcing failures through the public API.

## Assertions

- `matches(actor, "state.path")`. Sugar state check.
- `actor.snapshot()`: path, context, regions, `done`, `error`. Snapshot context is a copy.
- `actor.context`: live accumulated data.

## An App That Does Not Use Mantaq

`assertMatchesModel` (`@mantaq/test` 2.1) runs random walks on a model machine and on the app, and fails with a minimal event sequence after which their states differ.

<!-- docs-check: skip -->

```ts
import { assertMatchesModel } from "@mantaq/test";
import { test } from "vitest";
import { createCounter } from "./counter";
import { counterModel } from "./counter-model";

test("the counter app matches its model", async () => {
  await assertMatchesModel({
    model: () => counterModel.create(),
    start: () => createCounter(3),
    events: {
      increment: (app) => app.increment(),
      decrement: (app) => app.decrement(),
      reset: (app) => app.reset(),
    },
    state: (app) => (app.count === 0 ? "empty" : app.count >= 3 ? "full" : "counting"),
  });
});
```

Adapter rules:

- Every model input needs an `events` entry. The compiler names the missing one.
- `state` returns a model state name. The compiler lists them.
- An event the app cannot take right now does nothing in the adapter.
- An async result the app waits for (a save finishing) is a model input: the adapter makes it happen (resolve a fake request, then `await` the app).

Defaults: a fresh model and app per walk, 100 walks of up to 30 events, fixed seed, state compared after every event. It also fails when a model edge was never taken. Events with data need `payloads: { event: [...] }`.

Guide: https://anderscan.github.io/mantaq/guides/app-without-mantaq/

### A web page

Run `assertMatchesModel` inside a `@playwright/test` test. Every adapter function is async.

- `start` runs `page.goto(url)` and returns the page: a fresh document per walk. Never `page.setContent` on the same page: its scripts run again in the old window.
- Find controls as a person does (`getByRole`, `getByLabel`) and read only what is on screen (visible text, `isVisible`, `aria-*`). Never page variables or page functions.
- Name each model event for what a person does (`typeEmail`, `pressSignUp`): the failure table prints these names as the steps to reproduce.
- An event the page cannot take right now does nothing: when its control can be hidden, check `isVisible()` and return.
- Each `events` entry ends when the page shows the result. Wait for that result (`await page.getByRole("status").waitFor()`), never a fixed sleep. `state` only reads.
- `fill("")` on an empty field fires no `input` event: pick payload samples a person would type.
- `use: { actionTimeout: 5_000 }` in `playwright.config.ts`, so a wrong locator fails in seconds.
- `test.setTimeout(180_000)`: Playwright's default 30 s is too short for 100 walks of real clicks.

## Coverage (Harness + Traversal)

Prove behavior, don't just assert happy paths. The harness records visited states, fired transitions and executed effects, and offers `assert*` / `was*` helpers plus a `coverage()` report:

<!-- docs-check: skip -->

```ts
const h = createTestHarness(actor);
h.send(someEvent.create());
clock.advance(800);

h.coverage();
h.assertAllStatesVisited();
h.assertAllTransitionsVisited();
```

Other assertions cover a specific state, transition or effect being visited or never visited, and a context predicate that must never hold. List them from the `@mantaq/test` types; they take option objects.

`@mantaq/traversal` exposes graph algorithms (reachability, paths, cycles, unreachable states). Use unreachable-state analysis to find states you declared but never wired.

## Record Runs

Wrap the machine once per test file. Each passing test that builds an actor with it is recorded as a named run in `__runs__/<test file>.json`, which the live page lists.

<!-- docs-check: skip -->

```ts
import { recordRuns } from "@mantaq/inspect/record";
import { invite } from "./invite.machine.ts";

const make = recordRuns(invite);
```

Run the whole test file to refresh the sidecar, and commit it. With `CI` set, a stale file fails the test. Name tests as user-visible journeys: the test name is the run's label. Link a run as `?machine=<id>&run=<name>`.

A journey through an effect's answer injects that answer right after the send that started the effect: `actor.send(turnOffLink.create(...)); actor.inject({ type: "linkOffFailed", payload: { folderId } });`. Do not await between the two, or the real answer arrives first.

## When a change breaks a walk

After you change a machine, run every test file that imports its file, whole files so `__runs__` stays complete (`rg -l "<file name without .ts>" -g '*.test.ts'`). Use the repo's test runner; not on PATH: `node_modules/.bin/<runner>`. For each failing walk, ask: once the ask is done, are its title and steps still true?

- Yes: your change broke it. Fix the machine, never the walk's test, until it passes with its `__runs__` entry unchanged.
- No: the ask changes it. Name the walk with its `run=` link and ask before you change or delete it; leave it failing until the person answers.

`git status --short` lists the `__runs__` files you changed; `git diff` on them must show only walks you added or the ask changes. Any other changed walk is a silent re-record, so undo it. The failing test prints `on the board: ?machine=<id>&step=…`, one `step=` per step, the last is where it failed. That address is for you alone, never a link in a reply, docs, an issue or a PR.

## Design Gate

<!-- docs-check: skip -->

```ts
import { expectAllStatesReached, expectNoDesignErrors, expectReached } from "@mantaq/inspect";
import { join } from "node:path";
import { invite } from "./invite.machine.ts";

const target = {
  machine: invite,
  source: { file: join(import.meta.dirname, "invite-link.ts"), root: import.meta.dirname },
};
expectNoDesignErrors(target); // fuzzes: handler throws, unhandled effect sends, dead ends, unreachable states, events no state handles; with `source`: vague or undocumented names, handlers and effects
expectAllStatesReached(target);
expectReached(target, { transitions: [{ from: "waitingForAnswer", event: "ACCEPT" }] });
expectNoDesignErrors({ ...target, fuzz: false }); // structure only, no fuzzing
```

Fuzz throws in app code are real findings: fix them, never suppress.

Bad data without a crash: export `<machine id>Expectations` beside the machine, `payment: { neverSee: [{ address: "" }] }` typed `Expectations<typeof x>`.
`mustSee` lists contexts some run must reach. Tests can pass the block as `expectations` on the target.
Payloads come from `source` or `payloads: { event: [...] }`. If fuzzing sent an event with no payload and the machine read a field of it, all three checks stop and name the event and the fields: add `source` or real payloads, never reshape the design to get past it.

With `@mantaq/test` 2.0 the `*` any-node (`m.onAny`) counts in coverage: it is one node, covered once its event fires from any state.

## Messages Between Machines

To check that no message between your machines was dropped in a run, step it with `createDriver` from `@mantaq/inspect/drive` and read `after[].message`: `sender` is the part that sent it (`""` is the machine itself, `null` is unknown, or a part sending itself), and `dropped` is `"noHandler"` when the receiver had no handler in its state, else `null`. Needs `@mantaq/inspect` 0.37 or later.

<!-- docs-check: skip -->

```ts
import { createDriver } from "@mantaq/inspect/drive";
import { VirtualClock } from "@mantaq/core";

const driver = createDriver({
  id: "kitchen",
  create: () => {
    const clock = VirtualClock();
    const made = kitchen.create({ clock });
    return { actor: made.actor, clock, made };
  },
});
const live = driver.step({ kind: "event", event: "ORDER_PLACED", payload: { dish: "soup" } });
expect(live.after.filter((entry) => entry.message?.dropped)).toEqual([]);
```

## Test Design

- Happy path + every failure arc. Each error state needs a test that reaches it.
- Assert on state, not on internal wiring. `matches` + `done` cover most.
- Pin simulated randomness. Keep simulation effects' randomness contained so actor logic stays deterministic.
