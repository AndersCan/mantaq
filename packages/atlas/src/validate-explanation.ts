import type {
  AtlasBranch,
  AtlasBranchTarget,
  AtlasComparison,
  AtlasExplanation,
  AtlasLocation,
} from "./schema.ts";
import {
  isRecord,
  readBoolean,
  readEnum,
  readInteger,
  readList,
  readNullableString,
  readString,
  readStrings,
  report,
} from "./validate-read.ts";
import type { JsonObject, Reader } from "./validate-read.ts";

const OPERATORS: ReadonlyArray<AtlasComparison["operator"]> = [
  "<",
  "<=",
  ">",
  ">=",
  "===",
  "!==",
  "==",
  "!=",
];
const SOURCES: ReadonlyArray<AtlasComparison["source"]> = ["payload", "context"];

function readLocation(reader: Reader, record: JsonObject, path: string): AtlasLocation {
  return {
    file: readString(reader, { record, key: "file", path }),
    line: readInteger(reader, { record, key: "line", path }),
    column: readInteger(reader, { record, key: "column", path }),
  };
}

function readNullableLocation(
  reader: Reader,
  record: JsonObject,
  path: string,
): AtlasLocation | null {
  const value = record["location"];
  if (value === null) return null;
  if (isRecord(value)) return readLocation(reader, value, `${path}.location`);
  report(reader, { path: `${path}.location`, message: "expected null or object" });
  return null;
}

function readTarget(reader: Reader, record: JsonObject, path: string): AtlasBranchTarget {
  const value = record["target"];
  const at = `${path}.target`;
  if (!isRecord(value)) {
    report(reader, { path: at, message: "expected object" });
    return { kind: "stay" };
  }
  const kind = readEnum(reader, { record: value, key: "kind", path: at }, [
    "state",
    "stay",
    "unresolved",
  ]);
  if (kind === "state")
    return { kind, state: readString(reader, { record: value, key: "state", path: at }) };
  if (kind === "unresolved")
    return { kind, text: readString(reader, { record: value, key: "text", path: at }) };
  return { kind: "stay" };
}

function readBranch(reader: Reader, record: JsonObject, path: string): AtlasBranch {
  return {
    conditions: readStrings(reader, { record, key: "conditions", path }),
    target: readTarget(reader, record, path),
  };
}

function readComparison(reader: Reader, record: JsonObject, path: string): AtlasComparison {
  const literal = record["literal"];
  const valid =
    typeof literal === "number" || typeof literal === "string" || typeof literal === "boolean";
  if (!valid)
    report(reader, { path: `${path}.literal`, message: "expected number, string or boolean" });
  return {
    source: readEnum(reader, { record, key: "source", path }, SOURCES) ?? "payload",
    path: readString(reader, { record, key: "path", path }),
    operator: readEnum(reader, { record, key: "operator", path }, OPERATORS) ?? "===",
    literal: valid ? literal : 0,
  };
}

function readLiterals(reader: Reader, record: JsonObject, path: string): Array<number | string> {
  const value = record["literals"];
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" || typeof item === "string")
  ) {
    return value.filter(
      (item): item is number | string => typeof item === "number" || typeof item === "string",
    );
  }
  report(reader, { path: `${path}.literals`, message: "expected (number | string)[]" });
  return [];
}

function readAnalyzed(reader: Reader, record: JsonObject, path: string): AtlasExplanation {
  const location = record["location"];
  return {
    status: "analyzed",
    location: isRecord(location)
      ? readLocation(reader, location, `${path}.location`)
      : readLocation(reader, {}, `${path}.location`),
    registration: readEnum(reader, { record, key: "registration", path }, ["on", "onAny"]) ?? "on",
    branches: readList(reader, { record, key: "branches", path }, (item, at) =>
      readBranch(reader, item, at),
    ),
    payloadReads: readStrings(reader, { record, key: "payloadReads", path }),
    contextReads: readStrings(reader, { record, key: "contextReads", path }),
    contextWrites: readStrings(reader, { record, key: "contextWrites", path }),
    readsActorState: readBoolean(reader, { record, key: "readsActorState", path }),
    comparisons: readList(reader, { record, key: "comparisons", path }, (item, at) =>
      readComparison(reader, item, at),
    ),
    literals: readLiterals(reader, record, path),
  };
}

export function readExplanation(
  reader: Reader,
  at: { record: JsonObject; path: string },
): AtlasExplanation | null {
  const value = at.record["explanation"];
  const path = `${at.path}.explanation`;
  if (value === null) return null;
  if (!isRecord(value)) {
    report(reader, { path, message: "expected null or object" });
    return null;
  }
  const status = readEnum(reader, { record: value, key: "status", path }, [
    "analyzed",
    "not_analyzed",
  ]);
  if (status === "analyzed") return readAnalyzed(reader, value, path);
  return {
    status: "not_analyzed",
    location: readNullableLocation(reader, value, path),
    reason: readString(reader, { record: value, key: "reason", path }),
    snippet: readNullableString(reader, { record: value, key: "snippet", path }),
  };
}
