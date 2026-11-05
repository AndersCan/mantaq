import type { AnyActor } from "@mantaq/core";
import type { VizJson, VizStep } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expect, onTestFinished } from "vite-plus/test";
import { machineId } from "./inspect.ts";

interface Recorded {
  name: string;
  end: string;
  steps: VizStep[];
}

type Made = AnyActor<unknown> | { actor: AnyActor<unknown> };

/** Actors made so far per test name, to number a test's second actor. */
const counts = new Map<string, number>();

/** Runs recorded so far, per test file, per machine id. */
const files = new Map<string, Map<string, Recorded[]>>();

function actorOf(made: Made): AnyActor<unknown> {
  return "actor" in made ? made.actor : made;
}

function jsonPayload(payload: unknown): Either<string, VizJson> {
  const text = Either.from(() => JSON.stringify(payload ?? null));
  if (Either.isLeft(text)) return Either.left("payload is not JSON");
  return Either.right(text[1] === "{}" ? null : JSON.parse(text[1]));
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

/**
 * Wrap a machine factory in a vitest test file so every passing test that
 * builds an actor with it is recorded to `__runs__/<test file>.json` next to
 * the test: the events it handled and how far its clock moved. Run the whole
 * file to refresh it; with `CI` set a stale file fails the test instead.
 */
export function recordRuns<F extends (...args: never[]) => Made>(factory: F): F {
  const id = machineId(factory.name);
  const wrapped = (...args: Parameters<F>) => {
    const made = factory(...args);
    const actor = actorOf(made);
    const { testPath = "", currentTestName = "" } = expect.getState();
    const count = (counts.get(currentTestName) ?? 0) + 1;
    counts.set(currentTestName, count);
    const name = count === 1 ? currentTestName : `${currentTestName} #${count}`;
    const steps: VizStep[] = [];
    let problem = "";
    let seen = actor.clock.now();
    actor.on("transition", {
      fn: ({ event }) => {
        const now = actor.clock.now();
        if (now > seen) steps.push({ kind: "advance", ms: now - seen });
        seen = now;
        const payload = jsonPayload(event.payload);
        if (Either.isLeft(payload)) problem = payload[0];
        else steps.push({ kind: "event", event: event.type, payload: payload[1] });
      },
    });
    onTestFinished(({ task }) => {
      if (task.result?.state !== "pass") return;
      if (problem !== "") {
        console.warn(`recordRuns: "${currentTestName}" not recorded, ${problem}`);
        return;
      }
      const now = actor.clock.now();
      if (now > seen) steps.push({ kind: "advance", ms: now - seen });
      const runs = files.get(testPath) ?? new Map<string, Recorded[]>();
      files.set(testPath, runs);
      const list = runs.get(id) ?? [];
      runs.set(id, list);
      const run = { name, end: actor.state.name, steps };
      list.push(run);
      flush(testPath, id, run, runs);
    });
    return made;
  };
  Object.defineProperty(wrapped, "name", { value: factory.name });
  return wrapped as F;
}
