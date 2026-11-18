import { VirtualClock } from "@mantaq/core";
import type { AnyActor, ErrorInfo, Machine } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type { VizJson, VizStep } from "@mantaq/viz";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, expect } from "vite-plus/test";
import { isActor, messageOf, otherActorsOf } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { RUN_DROPPED, normalizeRun } from "./runs.ts";

interface Recorded {
  name: string;
  end: string;
  steps: VizStep[];
}

type Made = AnyActor<unknown> | { actor: AnyActor<unknown> };

interface Pending {
  actor: AnyActor<unknown>;
  id: string;
  name: string;
  testPath: string;
  steps: VizStep[];
  problem: string;
  seen: number;
  /** The send that made the actor fail (a handler or effect threw). Shown only when the test fails. */
  threw: Array<{ step: VizStep; at: number }>;
  /** Keys the test passed besides `clock`; empty when the run needs no replay. */
  extra: string[];
  /** The factory called the way the page calls it. */
  replay: (clock: VirtualClock) => Made;
}

/** Actors built during the running test attempt, flushed when it ends. */
let pending: Pending[] = [];

/** Runs recorded so far, per test file, per machine id. */
const files = new Map<string, Map<string, Recorded[]>>();

function actorOf(made: Made): AnyActor<unknown> {
  return "actor" in made ? made.actor : made;
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((each) => each === undefined || isJson(each));
}

function jsonPayload(payload: unknown): Either<string, VizJson> {
  if (payload !== undefined && !isJson(payload)) return Either.left("payload is not JSON");
  const text = Either.from(() => JSON.stringify(payload ?? null));
  if (Either.isLeft(text)) return Either.left("payload is not JSON");
  return Either.right(JSON.parse(text[1]));
}

function textOf(runs: Map<string, Recorded[]>): string {
  const sorted = [...runs].sort(([a], [b]) => a.localeCompare(b));
  const body = sorted.map(([id, list]) => [
    id,
    [...list].sort((a, b) => a.name.localeCompare(b.name)),
  ]);
  return `${JSON.stringify(Object.fromEntries(body), null, 2)}\n`;
}

function sidecarOf(testPath: string): string {
  return join(
    dirname(testPath),
    "__runs__",
    `${basename(testPath).replace(/\.[cm]?[jt]sx?$/, "")}.json`,
  );
}

function check(file: string, id: string, run: Recorded): void {
  const committed = Either.from(() => JSON.parse(readFileSync(file, "utf8")));
  const list: unknown = Either.isRight(committed) ? committed[1]?.[id] : undefined;
  const found = Array.isArray(list) ? list.find((each) => each?.name === run.name) : undefined;
  if (JSON.stringify(found) !== JSON.stringify(run)) {
    throw new Error(
      `recordRuns: ${file} is out of date for "${run.name}". Run the tests locally without CI set and commit the result.`,
    );
  }
}

function flush(testPath: string, id: string, run: Recorded, runs: Map<string, Recorded[]>): void {
  const file = sidecarOf(testPath);
  if (process.env["CI"]) return check(file, id, run);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, textOf(runs));
}

/** The factory as the page calls it: `{ clock }` alone. */
function pageTarget(each: Pending): FuzzTarget {
  return {
    id: each.id,
    create: () => {
      const clock = VirtualClock();
      const made = each.replay(clock);
      return isActor(made) ? { actor: made, clock } : { actor: made.actor, clock, made };
    },
  };
}

/** Empty when the run replays to the same end on `{ clock }` alone, else the reason. */
function replayProblem(each: Pending, run: Recorded): string {
  if (each.extra.length === 0) return "";
  const target = pageTarget(each);
  const replayed = Either.from(() => normalizeRun(target, run));
  const reason = Either.isLeft(replayed)
    ? `the factory threw with only { clock }: ${messageOf(replayed[0])}.`
    : Either.isLeft(replayed[1])
      ? replayed[1][0]
      : "";
  if (reason === "") return "";
  return `recordRuns: run "${run.name}"${RUN_DROPPED}${reason} This test passed: ${each.extra.join(", ")}.`;
}

/** A step as the board's address holds it: `@800`, `go`, `waiter>go={"a":1}`. */
function stepText(step: VizStep): string {
  if (step.kind === "advance") return `@${step.ms}`;
  const ref = step.actor;
  const head = ref !== undefined && "region" in ref ? `${ref.region}>${step.event}` : step.event;
  return `${head}=${JSON.stringify(step.payload)}`;
}

/** The board address that replays a failed test's walk up to where it failed. */
function boardLine(each: Pending): string {
  const run = {
    name: each.name,
    end: each.actor.state.name,
    steps: each.threw.reduceRight(
      (steps, { step, at }) => steps.toSpliced(at, 0, step),
      each.steps,
    ),
  };
  const replayed =
    each.problem === "" ? Either.from(() => normalizeRun(pageTarget(each), run)) : undefined;
  if (replayed === undefined || Either.isLeft(replayed) || Either.isLeft(replayed[1])) {
    return "on the board: not shown";
  }
  const query = new URLSearchParams({ machine: each.id });
  for (const step of replayed[1][1]) query.append("step", stepText(step));
  return `on the board: ?${query}`;
}

function finish(attempt: Pending[], passed: boolean): void {
  if (!passed) return;
  const counts = new Map<string, number>();
  const dropped: string[] = [];
  for (const each of attempt) {
    if (each.problem !== "") {
      console.warn(`recordRuns: "${each.name}" not recorded, ${each.problem}`);
      continue;
    }
    const now = timeOf(each.actor);
    if (now > each.seen) each.steps.push({ kind: "advance", ms: now - each.seen });
    const count = (counts.get(each.name) ?? 0) + 1;
    const name = count === 1 ? each.name : `${each.name} #${count}`;
    const run = { name, end: each.actor.state.name, steps: each.steps };
    const unreplayed = replayProblem(each, run);
    if (unreplayed !== "") {
      dropped.push(unreplayed);
      continue;
    }
    counts.set(each.name, count);
    const runs = files.get(each.testPath) ?? new Map<string, Recorded[]>();
    files.set(each.testPath, runs);
    const list = runs.get(each.id) ?? [];
    runs.set(each.id, list);
    list.push(run);
    flush(each.testPath, each.id, run, runs);
  }
  if (dropped.length > 0) throw new Error(dropped.join("\n"));
}

// One hook for the file, so a factory may be called in a test or in beforeEach.
afterEach(({ task }) => {
  const attempt = pending;
  pending = [];
  const failed = task.result?.state === "fail";
  if (failed) for (const each of attempt) console.log(boardLine(each));
  finish(attempt, !failed);
});

/**
 * Wrap a `machine(...)` in a vitest test file so every passing test that
 * builds an actor with it is recorded to `__runs__/<test file>.json` next to
 * the test: the events it handled and how far its clock moved. Run the whole
 * file to refresh it; with `CI` set a stale file fails the test instead.
 * `create` runs on a VirtualClock unless the test passes one. The machine may
 * be built in the test or in `beforeEach`. A retried test is recorded once,
 * from the attempt that passed. A failed test is not recorded; it prints
 * `on the board: ?machine=<id>&step=…`, the board address that replays its
 * walk up to where it failed, or `on the board: not shown`. A test that passes options besides `clock` is
 * replayed as `machine.create({ clock })`, as the page does; if it ends
 * elsewhere, the run is not recorded and the test fails. When the factory
 * returns other machines next to `actor` (`{ actor, store }`), their steps are
 * recorded too, as `actor: { region: "<property name>" }`. Breaking: a test
 * with such a factory must refresh its committed `__runs__` file once, without
 * `CI` set.
 */
export function recordRuns<Id extends string, Options extends object, M extends Made>(
  machine: Machine<Id, Options, M>,
): Machine<Id, Options, M> {
  const untyped: Machine = machine;
  return {
    id: machine.id,
    create: (options) => {
      const made = machine.create(
        Object.assign({}, options, { clock: options?.clock ?? VirtualClock() }),
      );
      track(made, {
        id: machine.id,
        extra: Object.keys(options ?? {}).filter((key) => key !== "clock"),
        replay: (clock) => untyped.create({ clock }),
      });
      return made;
    },
  };
}

/** An actor without a clock has no time: 0. */
function timeOf(actor: AnyActor<unknown>): number {
  return actor.clock?.now() ?? 0;
}

/** The step `event` makes, with `region` when another machine the factory returned took it. */
function eventStep(
  event: { type: string; payload?: unknown },
  region: string | undefined,
): Either<string, VizStep> {
  const payload = jsonPayload(event.payload);
  if (Either.isLeft(payload)) return Either.left(payload[0]);
  const step: VizStep = { kind: "event", event: event.type, payload: payload[1] };
  return Either.right(region === undefined ? step : { ...step, actor: { region } });
}

/** Record what the test does to the actor `made` holds, until the test ends. */
function track(made: Made, context: Pick<Pending, "id" | "extra" | "replay">): void {
  const actor = actorOf(made);
  const { testPath = "", currentTestName = "" } = expect.getState();
  const entry: Pending = {
    ...context,
    actor,
    name: currentTestName,
    testPath,
    steps: [],
    problem: "",
    seen: timeOf(actor),
    threw: [],
  };
  pending.push(entry);
  const note = (event: { type: string; payload?: unknown }, region?: string): void => {
    const now = timeOf(actor);
    if (now > entry.seen) entry.steps.push({ kind: "advance", ms: now - entry.seen });
    entry.seen = now;
    const step = eventStep(event, region);
    if (Either.isLeft(step)) entry.problem = step[0];
    else entry.steps.push(step[1]);
  };
  const threw = (info: ErrorInfo, region?: string): void => {
    const step = eventStep(info.event, region);
    if (Either.isRight(step)) entry.threw.push({ step: step[1], at: entry.steps.length });
  };
  actor.on("transition", { fn: ({ event }) => note(event) });
  actor.on("error", { fn: (info) => threw(info) });
  for (const [name, part] of Object.entries(otherActorsOf(made, actor))) {
    part.on("transition", { fn: ({ event }) => note(event, name) });
    part.on("error", { fn: (info) => threw(info, name) });
  }
}
