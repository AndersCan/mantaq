import type {
  AtlasJourney,
  AtlasJourneyInput,
  AtlasJourneyMove,
  AtlasJourneyMoveOutcome,
} from "./schema.ts";
import { readStep } from "./validate-fuzz.ts";
import {
  isRecord,
  readEnum,
  readInteger,
  readList,
  readNullableString,
  readString,
  readStrings,
  report,
} from "./validate-read.ts";
import type { JsonObject, Reader } from "./validate-read.ts";

const OUTCOMES: ReadonlyArray<AtlasJourneyMoveOutcome> = ["transition", "stay", "ignored"];

function readInput(reader: Reader, record: JsonObject, path: string): AtlasJourneyInput {
  const step = record["step"];
  if (!isRecord(step)) report(reader, { path: `${path}.step`, message: "expected object" });
  return {
    step: readStep(reader, isRecord(step) ? step : {}, `${path}.step`),
    note: readNullableString(reader, { record, key: "note", path }),
  };
}

function readMove(reader: Reader, record: JsonObject, path: string): AtlasJourneyMove {
  return {
    input: readInteger(reader, { record, key: "input", path }),
    from: readString(reader, { record, key: "from", path }),
    event: readString(reader, { record, key: "event", path }),
    to: readString(reader, { record, key: "to", path }),
    outcome: readEnum(reader, { record, key: "outcome", path }, OUTCOMES) ?? "ignored",
    edge: readNullableString(reader, { record, key: "edge", path }),
    effects: readStrings(reader, { record, key: "effects", path }),
  };
}

function readJourney(reader: Reader, record: JsonObject, path: string): AtlasJourney {
  return {
    id: readString(reader, { record, key: "id", path }),
    title: readString(reader, { record, key: "title", path }),
    description: readNullableString(reader, { record, key: "description", path }),
    start: readString(reader, { record, key: "start", path }),
    inputs: readList(reader, { record, key: "inputs", path }, (item, at) =>
      readInput(reader, item, at),
    ),
    moves: readList(reader, { record, key: "moves", path }, (item, at) =>
      readMove(reader, item, at),
    ),
  };
}

export function readJourneys(
  reader: Reader,
  at: { record: JsonObject; path: string },
): AtlasJourney[] {
  return readList(reader, { record: at.record, key: "journeys", path: at.path }, (item, path) =>
    readJourney(reader, item, path),
  );
}

/**
 * Journeys must stay on the drawn machine: known states and edges, inputs in
 * range and in order. A dangling reference would walk the viewer off the graph.
 */
export function checkJourneys(
  reader: Reader,
  context: { journeys: AtlasJourney[]; stateIds: Set<string>; edgeIds: Set<string>; path: string },
): void {
  context.journeys.forEach((journey, index) => {
    const at = `${context.path}.journeys[${index}]`;
    if (!context.stateIds.has(journey.start)) {
      report(reader, { path: `${at}.start`, message: `unknown state ${journey.start}` });
    }
    let previous = 0;
    journey.moves.forEach((move, moveIndex) => {
      const moveAt = `${at}.moves[${moveIndex}]`;
      for (const key of ["from", "to"] as const) {
        if (!context.stateIds.has(move[key])) {
          report(reader, { path: `${moveAt}.${key}`, message: `unknown state ${move[key]}` });
        }
      }
      if (move.edge !== null && !context.edgeIds.has(move.edge)) {
        report(reader, { path: `${moveAt}.edge`, message: `unknown edge ${move.edge}` });
      }
      if (move.input < previous || move.input >= journey.inputs.length) {
        report(reader, { path: `${moveAt}.input`, message: "input out of range or order" });
      }
      previous = move.input;
    });
  });
}
