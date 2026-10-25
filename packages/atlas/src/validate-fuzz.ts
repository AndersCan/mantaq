import type { AtlasFuzz, AtlasFuzzError, AtlasFuzzSequence, AtlasStep } from "./schema.ts";
import {
  isRecord,
  readInteger,
  readJson,
  readList,
  readString,
  readStrings,
  report,
} from "./validate-read.ts";
import type { JsonObject, Reader } from "./validate-read.ts";

function readStep(reader: Reader, record: JsonObject, path: string): AtlasStep {
  if (record["kind"] === "advance")
    return { kind: "advance", ms: readInteger(reader, { record, key: "ms", path }) };
  if (record["kind"] !== "event")
    report(reader, { path: `${path}.kind`, message: "expected event or advance" });
  return {
    kind: "event",
    event: readString(reader, { record, key: "event", path }),
    payload: readJson(reader, { record, key: "payload", path }),
  };
}

function readSteps(reader: Reader, record: JsonObject, path: string): AtlasStep[] {
  return readList(reader, { record, key: "steps", path }, (item, at) => readStep(reader, item, at));
}

function readSequence(reader: Reader, record: JsonObject, path: string): AtlasFuzzSequence {
  return {
    steps: readSteps(reader, record, path),
    discovered: readStrings(reader, { record, key: "discovered", path }),
  };
}

function readError(reader: Reader, record: JsonObject, path: string): AtlasFuzzError {
  return {
    from: readString(reader, { record, key: "from", path }),
    event: readString(reader, { record, key: "event", path }),
    message: readString(reader, { record, key: "message", path }),
    steps: readSteps(reader, record, path),
  };
}

export function readFuzz(
  reader: Reader,
  at: { record: JsonObject; path: string },
): AtlasFuzz | null {
  const value = at.record["fuzz"];
  if (value === null) return null;
  const path = `${at.path}.fuzz`;
  if (!isRecord(value)) {
    report(reader, { path, message: "expected null or object" });
    return null;
  }
  return {
    seed: readInteger(reader, { record: value, key: "seed", path }),
    iterations: readInteger(reader, { record: value, key: "iterations", path }),
    corpus: readList(reader, { record: value, key: "corpus", path }, (item, itemPath) =>
      readSequence(reader, item, itemPath),
    ),
    errors: readList(reader, { record: value, key: "errors", path }, (item, itemPath) =>
      readError(reader, item, itemPath),
    ),
  };
}
