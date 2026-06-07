import { expect, test, describe } from "vite-plus/test";
import { states } from "../src/state.ts";
import { StateRef } from "@mantaq/core";

describe("states", () => {
  test("creates multiple state refs from names", () => {
    const s = states("idle", "loading", "success");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.loading).toBeInstanceOf(StateRef);
    expect(s.success).toBeInstanceOf(StateRef);
    expect(s.idle.name).toBe("idle");
    expect(s.loading.name).toBe("loading");
    expect(s.success.name).toBe("success");
  });

  test("returns empty object for no names", () => {
    const s = states();
    expect(s).toEqual({});
  });

  test("each state ref is distinct", () => {
    const s = states("a", "b");
    expect(s.a).not.toBe(s.b);
  });

  test("single state", () => {
    const s = states("idle");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.idle.name).toBe("idle");
  });

  test("final() works on returned refs", () => {
    const s = states("pending", "resolved");
    const final = s.resolved.final();
    expect(final.isFinal).toBe(true);
    expect(final.name).toBe("resolved");
  });
});
