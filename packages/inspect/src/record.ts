import { VirtualClock } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type { VizJson, VizStep } from "@mantaq/viz";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, expect } from "vite-plus/test";
import { isActor, messageOf } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import { machineId } from "./inspect.ts";
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

function extraKeys(args: readonly unknown[]): string[] {
  const [only] = args;
  if (args.length !== 1 || typeof only !== "object" || only === null) return [];
  const proto = Object.getPrototypeOf(only);
  if (proto !== Object.prototype && proto !== null) return [];
  if ("now" in only && "advance" in only) return []; // a bare clock, not options
  return Object.keys(only).filter((key) => key !== "clock");
}

/** Empty when the run replays to the same end on `{ clock }` alone, else the reason. */
function replayProblem(each: Pending, run: Recorded): string {
  if (each.extra.length === 0) return "";
  const target: FuzzTarget = {
    id: each.id,
    create: () => {
      const clock = VirtualClock();
      const made = each.replay(clock);
      return isActor(made) ? { actor: made, clock } : { actor: made.actor, clock, made };
    },
  };
  const replayed = Either.from(() => normalizeRun(target, run));
  const reason = Either.isLeft(replayed)
    ? `the factory threw with only { clock }: ${messageOf(replayed[0])}.`
    : Either.isLeft(replayed[1])
      ? replayed[1][0]
      : "";
  if (reason === "") return "";
  return `recordRuns: run "${run.name}"${RUN_DROPPED}${reason} This test passed: ${each.extra.join(", ")}.`;
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
    const now = each.actor.clock.now();
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
  finish(attempt, task.result?.state !== "fail");
});

/**
 * Wrap a machine factory in a vitest test file so every passing test that
 * builds an actor with it is recorded to `__runs__/<test file>.json` next to
 * the test: the events it handled and how far its clock moved. Run the whole
 * file to refresh it; with `CI` set a stale file fails the test instead.
 * The factory may be called in the test or in `beforeEach`. A retried test is
 * recorded once, from the attempt that passed. A test that passes options
 * besides `clock` is replayed on the factory with only `{ clock }`, as the
 * page does; if it ends elsewhere, the run is not recorded and the test fails.
 */
export function recordRuns<F extends (...args: never[]) => Made>(factory: F): F {
  const id = machineId(factory.name);
  const wrapped = (...args: Parameters<F>) => {
    const made = factory(...args);
    const actor = actorOf(made);
    const { testPath = "", currentTestName = "" } = expect.getState();
    const entry: Pending = {
      actor,
      id,
      name: currentTestName,
      testPath,
      steps: [],
      problem: "",
      seen: actor.clock.now(),
      extra: extraKeys(args),
      replay: (clock) => Reflect.apply(factory, undefined, [{ clock }]),
    };
    pending.push(entry);
    actor.on("transition", {
      fn: ({ event }) => {
        const now = actor.clock.now();
        if (now > entry.seen) entry.steps.push({ kind: "advance", ms: now - entry.seen });
        entry.seen = now;
        const payload = jsonPayload(event.payload);
        if (Either.isLeft(payload)) entry.problem = payload[0];
        else entry.steps.push({ kind: "event", event: event.type, payload: payload[1] });
      },
    });
    return made;
  };
  Object.defineProperty(wrapped, "name", { value: factory.name });
  return wrapped as F;
}
