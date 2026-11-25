import { exampleTargets, handWrittenBaselines } from "../examples.ts";
import type { VizActorRef, VizStep } from "@mantaq/viz";
import type { FuzzTarget } from "../fuzz/run.ts";
import { grouped } from "../fixtures/grouped.ts";
import { isActor } from "../fuzz/run.ts";
import { lockedDoor } from "../fixtures/locked-door.ts";
import type { Machine } from "@mantaq/core";
import { parts } from "../fixtures/parts.ts";
import { photoQueue } from "../fixtures/photo-queue.ts";
import { sharedGo } from "../fixtures/shared-go.ts";
import type { SweepCase } from "./sweep.ts";
import { teamInbox } from "../fixtures/pool.ts";
import { timed } from "../fixtures/timed.ts";
import { toViz } from "../structure.ts";
import { uploadRegions } from "../fixtures/upload-regions.ts";
import { VirtualClock } from "@mantaq/core";

/** A fixture machine, run on a clock of its own; a factory that made `{ actor, ... }` keeps the rest as `made`. */
function fixtureTarget(machine: Machine): FuzzTarget {
  return {
    id: machine.id,
    create: () => {
      const clock = VirtualClock();
      const made = machine.create({ clock });
      if (isActor(made)) return { actor: made, clock };
      return { actor: made.actor, clock, made };
    },
  };
}

interface CaseOptions {
  walks: SweepCase["walks"];
}

function caseOf(target: FuzzTarget, options: CaseOptions): SweepCase {
  const viz = toViz([{ id: target.id, ...target.create() }]);
  return { name: target.id, viz, target, walks: options.walks };
}

/** A step as the viewer reads it from `?step=`: `@ms`, `[actor>]event`, or `[actor>]event=<json>`. */
function stepText(step: VizStep): string {
  if (step.kind === "advance") return `@${step.ms}`;
  const actor = step.actor === undefined ? "" : `${actorText(step.actor)}>`;
  const payload = JSON.stringify(step.payload);
  return step.payload === null ? `${actor}${step.event}` : `${actor}${step.event}=${payload}`;
}

function actorText(actor: VizActorRef): string {
  if ("region" in actor) return actor.region;
  const key = encodeURIComponent(actor.key);
  return `${actor.map}[${key}]`;
}

/** The example machines, walked along their hand-written tests. */
export function exampleCases(): SweepCase[] {
  const baselines = handWrittenBaselines();
  const cases: SweepCase[] = [];
  for (const target of exampleTargets()) {
    const walks: string[][] = [];
    for (const walk of baselines[target.id] ?? []) walks.push(walk.map((step) => stepText(step)));
    cases.push(caseOf(target, { walks }));
  }
  return cases;
}

/** Fixtures that draw what the examples do not: a board, a pool's children, regions, shared arrows, groups, a timer, a guard, a queue. */
export function fixtureCases(): SweepCase[] {
  return [
    caseOf(fixtureTarget(parts), { walks: [["go"]] }),
    caseOf(fixtureTarget(teamInbox), { walks: [['team.ITEM_ARRIVED={"item":"a"}']] }),
    caseOf(fixtureTarget(uploadRegions), { walks: [['upload>photoPicked={"fileName":"a.jpg"}']] }),
    caseOf(fixtureTarget(sharedGo), { walks: [["begin", "next"]] }),
    caseOf(fixtureTarget(grouped), { walks: [["checkout", "charged"]] }),
    caseOf(fixtureTarget(timed), { walks: [["start"]] }),
    caseOf(fixtureTarget(lockedDoor), { walks: [["pushDoor"]] }),
    caseOf(fixtureTarget(photoQueue), { walks: [['photoAdded={"photoId":"p1"}']] }),
  ];
}
