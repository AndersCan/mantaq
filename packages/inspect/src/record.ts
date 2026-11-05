import type { AnyActor } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type { VizJson, VizStep } from "@mantaq/viz";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, expect } from "vite-plus/test";
import { machineId } from "./inspect.ts";

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

function finish(attempt: Pending[], passed: boolean): void {
  if (!passed) return;
  const counts = new Map<string, number>();
  for (const each of attempt) {
    if (each.problem !== "") {
      console.warn(`recordRuns: "${each.name}" not recorded, ${each.problem}`);
      continue;
    }
    const now = each.actor.clock.now();
    if (now > each.seen) each.steps.push({ kind: "advance", ms: now - each.seen });
    const count = (counts.get(each.name) ?? 0) + 1;
    counts.set(each.name, count);
    const name = count === 1 ? each.name : `${each.name} #${count}`;
    const runs = files.get(each.testPath) ?? new Map<string, Recorded[]>();
    files.set(each.testPath, runs);
    const list = runs.get(each.id) ?? [];
    runs.set(each.id, list);
    const run = { name, end: each.actor.state.name, steps: each.steps };
    list.push(run);
    flush(each.testPath, each.id, run, runs);
  }
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
 * recorded once, from the attempt that passed.
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
