import { events } from "./event.ts";
import { fc, anyName, runProperty } from "@mantaq/pbt";
import { describe, test } from "vite-plus/test";

describe("events property tests", () => {
  test("builds refs keyed by the given names", () => {
    runProperty(fc.array(anyName, { minLength: 1, maxLength: 6 }), (names) => {
      const refs = events(...names);
      for (const name of names) {
        if (refs[name].type !== name) return false;
      }
      return true;
    });
  });
});
