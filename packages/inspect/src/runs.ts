import type { VizJson, VizRun, VizStep } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { actorMapsOf } from "./maps.ts";
import type { ActorMapLike } from "./maps.ts";
import { applyStep, eventCatalog, targetOf } from "./fuzz/run.ts";
import type { FuzzTarget } from "./fuzz/run.ts";
import type { AnyActor } from "@mantaq/core";

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

/** Why a step cannot be replayed (unknown region or event), or null. */
function stepProblem(
  root: AnyActor<unknown>,
  step: VizStep,
  maps: Readonly<Record<string, ActorMapLike>>,
): string | null {
  if (step.kind !== "event") return null;
  const ref = step.actor;
  if (ref !== undefined && "map" in ref && maps[ref.map] === undefined) {
    return `unknown actor map "${ref.map}"`;
  }
  // A map child may not exist yet while the steps are only being checked.
  if (ref !== undefined && "map" in ref) return null;
  const target = targetOf(root, ref);
  if (target === undefined) return `unknown region "${ref?.region}"`;
  const catalog = eventCatalog(target);
  if (catalog.inputs.includes(step.event) || catalog.internal.includes(step.event)) return null;
  return ref === undefined
    ? `unknown event "${step.event}"`
    : `unknown event "${step.event}" in region ${ref.region}`;
}

function release(actor: AnyActor<unknown>, maps: Readonly<Record<string, ActorMapLike>>): void {
  for (const map of Object.values(maps)) map.dispose();
  actor.dispose();
}

/**
 * Replay a raw recording on a fresh actor and keep only the steps that cannot
 * be reproduced: an internal event the replay already produced (a timer after
 * its advance, a synchronous emit after its send) is dropped, one it did not
 * (a promise result) is kept. Left when the replay ends elsewhere than the
 * test did.
 */
export function normalizeRun(target: FuzzTarget, run: RecordedRun): Either<string, VizStep[]> {
  const { actor, clock, made } = target.create();
  const maps = actorMapsOf(made).maps;
  const internal = new Set(eventCatalog(actor).internal);
  let produced: string[] = [];
  actor.on("transition", { fn: ({ event }) => void produced.push(event.type) });
  for (const step of run.steps) {
    const problem = stepProblem(actor, step, maps);
    if (problem !== null) {
      release(actor, maps);
      return Either.left(problem);
    }
  }
  const kept: VizStep[] = [];
  for (const step of run.steps) {
    const root = step.kind === "event" && step.actor === undefined;
    if (root && internal.has(step.event) && dropOne(produced, step.event)) continue;
    produced = [];
    applyStep(actor, { step, clock, internal, maps });
    if (root && internal.has(step.event)) dropOne(produced, step.event);
    kept.push(step);
  }
  const ended = actor.state.name;
  release(actor, maps);
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
  if (value["kind"] === "advance") return typeof value["ms"] === "number" && value["ms"] >= 0;
  const actor = value["actor"];
  const actorOk =
    actor === undefined ||
    (isRecord(actor) &&
      (typeof actor["region"] === "string" ||
        (typeof actor["map"] === "string" && typeof actor["key"] === "string")));
  return (
    value["kind"] === "event" &&
    typeof value["event"] === "string" &&
    isJson(value["payload"]) &&
    actorOk
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

function readFile(file: string): { runs: RecordedRuns; warnings: string[] } {
  const name = basename(file);
  const text = Either.from(() => JSON.parse(readFileSync(file, "utf8")));
  if (Either.isLeft(text) || !isRecord(text[1])) {
    return { runs: {}, warnings: [`${RUNS_DIR}/${name}: not a JSON object, ignored`] };
  }
  const entries = Object.entries(text[1]).map(([id, runs]) => {
    const list: unknown[] = Array.isArray(runs) ? runs : [];
    const valid = list.filter(isRecorded);
    const bad = Array.isArray(runs) ? list.length - valid.length : 1;
    return { id, valid, bad };
  });
  return {
    runs: Object.fromEntries(entries.map(({ id, valid }) => [id, valid])),
    warnings: entries
      .filter(({ bad }) => bad > 0)
      .map(({ id, bad }) => `${RUNS_DIR}/${name}: ${bad} malformed run(s) for "${id}" ignored`),
  };
}

/**
 * Every run recorded for the test files in `dir`: the `__runs__/*.json` files
 * next to them, merged by machine id in file-name order, and a warning for
 * each file or run that could not be read.
 */
export function readRuns(dir: string): { runs: RecordedRuns; warnings: string[] } {
  const listing = Either.from(() => readdirSync(join(dir, RUNS_DIR)).sort());
  if (Either.isLeft(listing)) return { runs: {}, warnings: [] };
  const merged: RecordedRuns = {};
  const warnings: string[] = [];
  for (const name of listing[1].filter((each) => each.endsWith(".json"))) {
    const read = readFile(join(dir, RUNS_DIR, name));
    warnings.push(...read.warnings);
    for (const [id, runs] of Object.entries(read.runs)) {
      merged[id] = [...(merged[id] ?? []), ...runs];
    }
  }
  return { runs: merged, warnings };
}
