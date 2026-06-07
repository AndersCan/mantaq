import { expect, test, describe } from "vite-plus/test";
import { states } from "../src/state.ts";
import { StateRef } from "@mantaq/core";

describe("states", () => {
  test("creates refs for given names", () => {
    const s = states("idle", "loading", "done");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.idle.name).toBe("idle");
    expect(s.loading.name).toBe("loading");
    expect(s.done.name).toBe("done");
  });

  test("returns empty object for no names", () => {
    const s = states();
    expect(s).toEqual({});
  });

  test("each ref is independent", () => {
    const s = states("a", "b");
    expect(s.a).not.toBe(s.b);
  });
});
