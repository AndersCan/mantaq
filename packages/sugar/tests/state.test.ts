import { expect, test, describe } from "vite-plus/test";
import { states } from "../src/state.ts";
import { StateRef } from "@mantaq/core";

describe("states", () => {
  test("creates multiple state refs", () => {
    const s = states("idle", "loading", "success");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.loading).toBeInstanceOf(StateRef);
    expect(s.success).toBeInstanceOf(StateRef);
    expect(s.idle.name).toBe("idle");
    expect(s.loading.name).toBe("loading");
    expect(s.success.name).toBe("success");
  });

  test("single state", () => {
    const s = states("idle");
    expect(s.idle).toBeInstanceOf(StateRef);
    expect(s.idle.name).toBe("idle");
  });

  test("states are independent refs", () => {
    const s = states("a", "b");
    expect(s.a).not.toBe(s.b);
  });
});
