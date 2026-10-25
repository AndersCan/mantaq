import { ATLAS_SCHEMA_VERSION } from "./schema.ts";
import type {
  AtlasCoverage,
  AtlasDocument,
  AtlasEdge,
  AtlasEdgeKind,
  AtlasEvent,
  AtlasMachine,
  AtlasState,
} from "./schema.ts";
import { Either } from "@mantaq/utils";

/** One problem found while reading a document, with a JSON-path-like location. */
export interface AtlasIssue {
  path: string;
  message: string;
}

type JsonObject = Record<string, unknown>;

interface Reader {
  issues: AtlasIssue[];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(reader: Reader, issue: AtlasIssue): void {
  reader.issues.push(issue);
}

function readString(reader: Reader, at: { record: JsonObject; key: string; path: string }): string {
  const value = at.record[at.key];
  if (typeof value === "string") return value;
  report(reader, { path: `${at.path}.${at.key}`, message: "expected string" });
  return "";
}

function readNullableString(
  reader: Reader,
  at: { record: JsonObject; key: string; path: string },
): string | null {
  const value = at.record[at.key];
  if (value === null) return null;
  return readString(reader, at);
}

function readBoolean(
  reader: Reader,
  at: { record: JsonObject; key: string; path: string },
): boolean {
  const value = at.record[at.key];
  if (typeof value === "boolean") return value;
  report(reader, { path: `${at.path}.${at.key}`, message: "expected boolean" });
  return false;
}

function readStrings(
  reader: Reader,
  at: { record: JsonObject; key: string; path: string },
): string[] {
  const value = at.record[at.key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.filter((item): item is string => typeof item === "string");
  }
  report(reader, { path: `${at.path}.${at.key}`, message: "expected string[]" });
  return [];
}

function readCoverage(
  reader: Reader,
  at: { record: JsonObject; key: string; path: string },
): AtlasCoverage | null {
  const value = at.record[at.key];
  if (value === null) return null;
  if (isRecord(value) && Number.isInteger(value["hits"]) && typeof value["hits"] === "number") {
    return { hits: value["hits"] };
  }
  report(reader, { path: `${at.path}.${at.key}`, message: "expected null or { hits: integer }" });
  return null;
}

function readList<T>(
  reader: Reader,
  at: { record: JsonObject; key: string; path: string },
  item: (record: JsonObject, path: string) => T,
): T[] {
  const value = at.record[at.key];
  if (!Array.isArray(value)) {
    report(reader, { path: `${at.path}.${at.key}`, message: "expected array" });
    return [];
  }
  return value.flatMap((entry, index) => {
    const path = `${at.path}.${at.key}[${index}]`;
    if (isRecord(entry)) return [item(entry, path)];
    report(reader, { path, message: "expected object" });
    return [];
  });
}

const EDGE_KINDS: ReadonlyArray<AtlasEdgeKind> = ["initial", "transition", "effect"];

function readEdgeKind(reader: Reader, at: { record: JsonObject; path: string }): AtlasEdgeKind {
  const value = at.record["kind"];
  const kind = EDGE_KINDS.find((candidate) => candidate === value);
  if (kind) return kind;
  report(reader, { path: `${at.path}.kind`, message: `expected one of ${EDGE_KINDS.join(", ")}` });
  return "transition";
}

function readExplanation(reader: Reader, at: { record: JsonObject; path: string }): null {
  if (at.record["explanation"] !== null) {
    report(reader, { path: `${at.path}.explanation`, message: "expected null" });
  }
  return null;
}

function readState(reader: Reader, record: JsonObject, path: string): AtlasState {
  return {
    id: readString(reader, { record, key: "id", path }),
    label: readString(reader, { record, key: "label", path }),
    region: readNullableString(reader, { record, key: "region", path }),
    initial: readBoolean(reader, { record, key: "initial", path }),
    final: readBoolean(reader, { record, key: "final", path }),
    coverage: readCoverage(reader, { record, key: "coverage", path }),
  };
}

function readEvent(reader: Reader, record: JsonObject, path: string): AtlasEvent {
  if (record["payloadType"] !== null) {
    report(reader, { path: `${path}.payloadType`, message: "expected null" });
  }
  return {
    id: readString(reader, { record, key: "id", path }),
    internal: readBoolean(reader, { record, key: "internal", path }),
    payloadType: null,
  };
}

function readEdge(reader: Reader, record: JsonObject, path: string): AtlasEdge {
  return {
    id: readString(reader, { record, key: "id", path }),
    from: readString(reader, { record, key: "from", path }),
    event: readString(reader, { record, key: "event", path }),
    to: readNullableString(reader, { record, key: "to", path }),
    kind: readEdgeKind(reader, { record, path }),
    emits: readStrings(reader, { record, key: "emits", path }),
    contexts: readStrings(reader, { record, key: "contexts", path }),
    explanation: readExplanation(reader, { record, path }),
    coverage: readCoverage(reader, { record, key: "coverage", path }),
  };
}

/** Edge endpoints must name declared states; a dangling reference is a broken document. */
function checkReferences(reader: Reader, machine: AtlasMachine, path: string): void {
  const stateIds = new Set(machine.states.map((state) => state.id));
  const known = (id: string) => stateIds.has(id) || id === "__initial__";
  machine.edges.forEach((edge, index) => {
    if (!known(edge.from)) {
      report(reader, {
        path: `${path}.edges[${index}].from`,
        message: `unknown state ${edge.from}`,
      });
    }
    if (edge.to !== null && !stateIds.has(edge.to)) {
      report(reader, { path: `${path}.edges[${index}].to`, message: `unknown state ${edge.to}` });
    }
  });
  if (machine.initial !== null && !stateIds.has(machine.initial)) {
    report(reader, { path: `${path}.initial`, message: `unknown state ${machine.initial}` });
  }
}

function readMachine(reader: Reader, record: JsonObject, path: string): AtlasMachine {
  const machine: AtlasMachine = {
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
  };
  checkReferences(reader, machine, path);
  return machine;
}

/**
 * Read an untrusted value (parsed JSON) as an atlas document. Returns every
 * issue found, not just the first, so a broken file can be fixed in one pass.
 */
export function validateAtlas(value: unknown): Either<AtlasIssue[], AtlasDocument> {
  const reader: Reader = { issues: [] };
  if (!isRecord(value)) return Either.left([{ path: "$", message: "expected object" }]);
  if (value["schemaVersion"] !== ATLAS_SCHEMA_VERSION) {
    return Either.left([
      {
        path: "$.schemaVersion",
        message: `expected ${ATLAS_SCHEMA_VERSION}, got ${JSON.stringify(value["schemaVersion"])}`,
      },
    ]);
  }
  const machines = readList(reader, { record: value, key: "machines", path: "$" }, (item, at) =>
    readMachine(reader, item, at),
  );
  if (reader.issues.length > 0) return Either.left(reader.issues);
  const document: AtlasDocument = { schemaVersion: ATLAS_SCHEMA_VERSION, machines };
  return Either.right(document);
}

/** Parse JSON text and validate it. JSON syntax errors become an issue at `$`. */
export function parseAtlas(text: string): Either<AtlasIssue[], AtlasDocument> {
  const parsed = Either.from((): unknown => JSON.parse(text));
  if (Either.isLeft(parsed)) {
    const reason = parsed[0] instanceof Error ? parsed[0].message : String(parsed[0]);
    return Either.left([{ path: "$", message: `invalid JSON: ${reason}` }]);
  }
  return validateAtlas(parsed[1]);
}
