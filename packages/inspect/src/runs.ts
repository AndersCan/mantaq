import type { VizJson, VizRun, VizStep } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyStep, eventCatalog } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";

/** A run as a test recorded it: the steps it took and the state its actor ended in. */
interface RecordedRun extends VizRun {
  end: string;
}

/** Recorded runs per machine id. */
export type RecordedRuns = Record<string, RecordedRun[]>;

/** Name of the folder, next to the test files, that holds recorded runs. */
const RUNS_DIR = "__runs__";

function dropOne(list: string[], item: string): boolean {
  const at = list.indexOf(item);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/**
 * Replay a raw recording on a fresh actor and keep only the steps that cannot
 * be reproduced: an internal event the replay already produced (a timer after
 * its advance, a synchronous emit after its send) is dropped, one it did not
 * (a promise result) is kept. Left when the replay ends elsewhere than the
 * test did.
 */
export function normalizeRun(target: FuzzTarget, run: RecordedRun): Either<string, VizStep[]> {
  const { actor, clock } = target.create();
  const internal = new Set(eventCatalog(actor).internal);
  let produced: string[] = [];
  actor.on("transition", { fn: ({ event }) => void produced.push(event.type) });
  const kept: VizStep[] = [];
  for (const step of run.steps) {
    if (step.kind === "event" && internal.has(step.event) && dropOne(produced, step.event))
      continue;
    produced = [];
    applyStep(actor, { step, clock, internal });
    if (step.kind === "event" && internal.has(step.event)) dropOne(produced, step.event);
    kept.push(step);
  }
  const ended = actor.state.name;
  actor.dispose();
  return ended === run.end
    ? Either.right(kept)
    : Either.left(`replays to ${ended}, the test ended in ${run.end}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is VizJson {
  return Either.isRight(Either.from(() => JSON.stringify(value)));
}

function isStep(value: unknown): value is VizStep {
  if (!isRecord(value)) return false;
  if (value["kind"] === "advance") return typeof value["ms"] === "number";
  return (
    value["kind"] === "event" && typeof value["event"] === "string" && isJson(value["payload"])
  );
}

function isRecorded(value: unknown): value is RecordedRun {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["end"] === "string" &&
    Array.isArray(value["steps"]) &&
    value["steps"].every(isStep)
  );
}

function readFile(file: string): RecordedRuns {
  const text = Either.from(() => JSON.parse(readFileSync(file, "utf8")));
  if (Either.isLeft(text) || !isRecord(text[1])) return {};
  return Object.fromEntries(
    Object.entries(text[1]).map(([id, runs]) => [
      id,
      Array.isArray(runs) ? runs.filter(isRecorded) : [],
    ]),
  );
}

/**
 * Every run recorded for the test files in `dir`: the `__runs__/*.json` files
 * next to them, merged by machine id in file-name order.
 */
export function readRuns(dir: string): RecordedRuns {
  const listing = Either.from(() => readdirSync(join(dir, RUNS_DIR)).sort());
  if (Either.isLeft(listing)) return {};
  const merged: RecordedRuns = {};
  for (const name of listing[1].filter((each) => each.endsWith(".json"))) {
    for (const [id, runs] of Object.entries(readFile(join(dir, RUNS_DIR, name)))) {
      merged[id] = [...(merged[id] ?? []), ...runs];
    }
  }
  return merged;
}
