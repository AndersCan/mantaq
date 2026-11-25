import { EXAMPLE_ROOT, exampleTargets, handWrittenBaselines } from "../examples.ts";
import type { VizActorRef, VizDocument, VizJson, VizStep } from "@mantaq/viz";
import type { FuzzTarget } from "../fuzz/run.ts";
import { grouped } from "../fixtures/grouped.ts";
import { inspect } from "../inspect.ts";
import { isActor } from "../fuzz/run.ts";
import { join } from "node:path";
import { lockedDoor } from "../fixtures/locked-door.ts";
import { orderMachine } from "../../../examples/order/order.ts";
import type { Machine } from "@mantaq/core";
import { parts } from "../fixtures/parts.ts";
import { photoQueue } from "../fixtures/photo-queue.ts";
import { sharedGo } from "../fixtures/shared-go.ts";
import type { SweepCase } from "./sweep.ts";
import { teamInbox } from "../fixtures/pool.ts";
import { timed } from "../fixtures/timed.ts";
import { uploadRegions } from "../fixtures/upload-regions.ts";
import { VirtualClock } from "@mantaq/core";
import { VIZ_SCHEMA_VERSION } from "@mantaq/viz";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

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
  /** The file that registers the handlers: payload fields from the event types, as the docs read them. */
  source: string;
  walks: SweepCase["walks"];
  payloads?: Readonly<Record<string, ReadonlyArray<VizJson>>>;
}

/** The document the docs would draw for `machine`: structure, handler readings, payload fields and seeded fuzz coverage. */
function caseOf(machine: Machine, options: CaseOptions): SweepCase {
  const source = { file: options.source, root: EXAMPLE_ROOT };
  const inspected = inspect({ machine, source, payloads: options.payloads });
  const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [inspected.machine] };
  return { name: machine.id, viz, target: fixtureTarget(machine), walks: options.walks };
}

interface FixtureOptions {
  /** The fixture's file name in `src/fixtures`. */
  file: string;
  walks: SweepCase["walks"];
}

function fixtureCase(machine: Machine, options: FixtureOptions): SweepCase {
  return caseOf(machine, { source: join(FIXTURES, options.file), walks: options.walks });
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
    cases.push(caseOf(target.machine, { source: target.source, walks, payloads: target.payloads }));
  }
  return cases;
}

/** The order of the group guide: the walk the guide takes into `payment`, out to `delivery`, and back to the shop. */
function orderCase(): SweepCase {
  const source = join(EXAMPLE_ROOT, "packages", "examples", "order", "order.ts");
  const walk = ["placeOrder", "declined", "retryCard", "charged", "shipped", "arrived"];
  return caseOf(orderMachine, { source, walks: [[...walk, "nobodyAnswered", "sentBack"]] });
}

/** Fixtures that draw what the examples do not: a board, a pool's children, regions, shared arrows, groups, a timer, a guard, a queue. Then the order of the group guide. */
export function fixtureCases(): SweepCase[] {
  return [
    fixtureCase(parts, { file: "parts.ts", walks: [["go"]] }),
    fixtureCase(teamInbox, { file: "pool.ts", walks: [['team.ITEM_ARRIVED={"item":"a"}']] }),
    fixtureCase(uploadRegions, {
      file: "upload-regions.ts",
      walks: [['upload>photoPicked={"fileName":"a.jpg"}']],
    }),
    fixtureCase(sharedGo, { file: "shared-go.ts", walks: [["begin", "next"]] }),
    fixtureCase(grouped, { file: "grouped.ts", walks: [["checkout", "charged"]] }),
    fixtureCase(timed, { file: "timed.ts", walks: [["start"]] }),
    fixtureCase(lockedDoor, { file: "locked-door.ts", walks: [["pushDoor"]] }),
    fixtureCase(photoQueue, { file: "photo-queue.ts", walks: [['photoAdded={"photoId":"p1"}']] }),
    orderCase(),
  ];
}
