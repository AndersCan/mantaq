import { toAtlas } from "./atlas.ts";
import { exampleInputs, exampleTargets } from "./examples.ts";
import { fuzz } from "./fuzz/fuzz.ts";
import { fuzzedMachine } from "./fuzz/to-atlas.ts";
import { ATLAS_SCHEMA_VERSION } from "./schema.ts";
import type { AtlasDocument } from "./schema.ts";
import { serializeAtlas } from "./serialize.ts";
import { parseAtlas } from "./validate.ts";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

describe("parseAtlas", () => {
  test("round-trips every exported example", () => {
    const atlas = toAtlas(exampleInputs());
    const parsed = parseAtlas(serializeAtlas(atlas));
    expect(Either.getRight(parsed)).toEqual(atlas);
  });

  test("round-trips fuzzed machines, including null payloads", () => {
    const machines = exampleTargets().map((target) =>
      fuzzedMachine(target, fuzz(target, { seed: 3, iterations: 300 })),
    );
    const atlas: AtlasDocument = { schemaVersion: ATLAS_SCHEMA_VERSION, machines };
    expect(Either.getRight(parseAtlas(serializeAtlas(atlas)))).toEqual(atlas);
  });
});
