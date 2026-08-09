import { test, describe } from "vite-plus/test";
import { fc, anyName, runProperty } from "@mantaq/pbt";
import { states } from "../src/state.ts";
import { events } from "../src/event.ts";

describe("sugar states helper property tests", () => {
  test("states builds refs keyed by the given names", () => {
    runProperty(fc.array(anyName, { minLength: 1, maxLength: 6 }), (names) => {
      const refs = states(...names);
      for (const name of names) {
        if (refs[name].name !== name) return false;
      }
      return true;
    });
  });
});

describe("sugar events helper property tests", () => {
  test("events builds refs keyed by the given ids", () => {
    runProperty(fc.array(anyName, { minLength: 1, maxLength: 6 }), (names) => {
      const refs = events(...names);
      for (const name of names) {
        if (refs[name].id !== name) return false;
      }
      return true;
    });
  });
});
