import { expect, test, describe } from "vite-plus/test";
import { states } from "../src/state.ts";
import { StateRef } from "@mantaq/core";

describe("states", () => {
  test("creates StateRef objects for each name", () => {
    const s = states("idle", "loading", "done");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.loading).toBeInstanceOf(StateRef);
    expect(s.done).toBeInstanceOf(StateRef);
  });

  test("creates StateRef with correct names", () => {
    const s = states("idle", "loading");
    expect(s.idle.name).toBe("idle");
    expect(s.loading.name).toBe("loading");
  });

  test("returns record keyed by state name", () => {
    const s = states("a", "b");
    expect(Object.keys(s)).toEqual(["a", "b"]);
  });

  test("empty — no names returns empty record", () => {
    const s = states();
    expect(Object.keys(s)).toEqual([]);
  });

  test("single name", () => {
    const s = states("only");
    expect(s.only.name).toBe("only");
  });
});
