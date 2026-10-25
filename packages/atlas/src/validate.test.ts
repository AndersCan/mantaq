import { toAtlas } from "./atlas.ts";
import { exampleInputs } from "./examples.ts";
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
});
