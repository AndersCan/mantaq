import { VIZ_SCHEMA_VERSION, isAnyState } from "./schema.ts";
import type {
  VizDocument,
  VizEdge,
  VizEdgeKind,
  VizEdgeOrigin,
  VizEvent,
  VizMachine,
  VizState,
} from "./schema.ts";
import { readExplanation } from "./validate-explanation.ts";
import { readFuzz, readRuns } from "./validate-fuzz.ts";
import {
  isRecord,
  readBoolean,
  readCoverage,
  readEnum,
  readList,
  readNullableString,
  readNullableStrings,
  readString,
  readStrings,
  report,
} from "./validate-read.ts";
import type { VizIssue, JsonObject, Reader } from "./validate-read.ts";
import { Either } from "@mantaq/utils";

export type { VizIssue } from "./validate-read.ts";

const EDGE_KINDS: ReadonlyArray<VizEdgeKind> = ["initial", "transition", "effect", "stay"];
const EDGE_ORIGINS: ReadonlyArray<VizEdgeOrigin> = ["declared", "probe", "fuzz"];

function readState(reader: Reader, record: JsonObject, path: string): VizState {
  return {
    id: readString(reader, { record, key: "id", path }),
    label: readString(reader, { record, key: "label", path }),
    region: readNullableString(reader, { record, key: "region", path }),
    initial: readBoolean(reader, { record, key: "initial", path }),
    final: readBoolean(reader, { record, key: "final", path }),
    effects: readList(reader, { record, key: "effects", path }, (item, at) => ({
      name: readString(reader, { record: item, key: "name", path: at }),
      sends: readNullableStrings(reader, { record: item, key: "sends", path: at }),
    })),
    coverage: readCoverage(reader, { record, key: "coverage", path }),
    tested: readCoverage(reader, { record, key: "tested", path }),
    doc: readNullableString(reader, { record, key: "doc", path }),
  };
}

function readEvent(reader: Reader, record: JsonObject, path: string): VizEvent {
  if (record["payloadType"] !== null) {
    report(reader, { path: `${path}.payloadType`, message: "expected null" });
  }
  return {
    id: readString(reader, { record, key: "id", path }),
    internal: readBoolean(reader, { record, key: "internal", path }),
    doc: readNullableString(reader, { record, key: "doc", path }),
    payloadType: null,
  };
}

function readEdge(reader: Reader, record: JsonObject, path: string): VizEdge {
  return {
    id: readString(reader, { record, key: "id", path }),
    from: readString(reader, { record, key: "from", path }),
    event: readString(reader, { record, key: "event", path }),
    to: readNullableString(reader, { record, key: "to", path }),
    kind: readEnum(reader, { record, key: "kind", path }, EDGE_KINDS) ?? "transition",
    origin: readEnum(reader, { record, key: "origin", path }, EDGE_ORIGINS) ?? "probe",
    emits: readStrings(reader, { record, key: "emits", path }),
    contexts: readStrings(reader, { record, key: "contexts", path }),
    explanation: readExplanation(reader, { record, path }),
    doc: readNullableString(reader, { record, key: "doc", path }),
    coverage: readCoverage(reader, { record, key: "coverage", path }),
    tested: readCoverage(reader, { record, key: "tested", path }),
  };
}

/** Edge endpoints must name declared states; a dangling reference is a broken document. */
function checkReferences(reader: Reader, machine: VizMachine, path: string): void {
  const stateIds = new Set(machine.states.map((state) => state.id));
  const known = (id: string) => stateIds.has(id) || id === "__initial__" || isAnyState(id);
  machine.edges.forEach((edge, index) => {
    if (!known(edge.from)) {
      report(reader, {
        path: `${path}.edges[${index}].from`,
        message: `unknown state ${edge.from}`,
      });
    }
    const anyStay = edge.kind === "stay" && edge.to === edge.from && isAnyState(edge.from);
    if (edge.to !== null && !stateIds.has(edge.to) && !anyStay) {
      report(reader, { path: `${path}.edges[${index}].to`, message: `unknown state ${edge.to}` });
    }
  });
  if (machine.initial !== null && !stateIds.has(machine.initial)) {
    report(reader, { path: `${path}.initial`, message: `unknown state ${machine.initial}` });
  }
}

function readMachine(reader: Reader, record: JsonObject, path: string): VizMachine {
  const machine: VizMachine = {
    id: readString(reader, { record, key: "id", path }),
    initial: readNullableString(reader, { record, key: "initial", path }),
    regions: readStrings(reader, { record, key: "regions", path }),
    states: readList(reader, { record, key: "states", path }, (item, at) =>
      readState(reader, item, at),
    ),
    events: readList(reader, { record, key: "events", path }, (item, at) =>
      readEvent(reader, item, at),
    ),
    edges: readList(reader, { record, key: "edges", path }, (item, at) =>
      readEdge(reader, item, at),
    ),
    fuzz: readFuzz(reader, { record, path }),
    runs: readRuns(reader, { record, path }),
  };
  checkReferences(reader, machine, path);
  return machine;
}

/**
 * Read an untrusted value (parsed JSON) as an viz document. Returns every
 * issue found, not just the first, so a broken file can be fixed in one pass.
 */
export function validateViz(value: unknown): Either<VizIssue[], VizDocument> {
  const reader: Reader = { issues: [] };
  if (!isRecord(value)) return Either.left([{ path: "$", message: "expected object" }]);
  if (value["schemaVersion"] !== VIZ_SCHEMA_VERSION) {
    return Either.left([
      {
        path: "$.schemaVersion",
        message: `expected ${VIZ_SCHEMA_VERSION}, got ${JSON.stringify(value["schemaVersion"])}`,
      },
    ]);
  }
  const machines = readList(reader, { record: value, key: "machines", path: "$" }, (item, at) =>
    readMachine(reader, item, at),
  );
  if (reader.issues.length > 0) return Either.left(reader.issues);
  const document: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines };
  return Either.right(document);
}

/** Parse JSON text and validate it. JSON syntax errors become an issue at `$`. */
export function parseViz(text: string): Either<VizIssue[], VizDocument> {
  const parsed = Either.from((): unknown => JSON.parse(text));
  if (Either.isLeft(parsed)) {
    const reason = parsed[0] instanceof Error ? parsed[0].message : String(parsed[0]);
    return Either.left([{ path: "$", message: `invalid JSON: ${reason}` }]);
  }
  return validateViz(parsed[1]);
}
