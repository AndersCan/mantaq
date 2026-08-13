import { expect, test, describe, expectTypeOf } from "vite-plus/test";
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

  test("object entries declare finality inline", () => {
    const s = states("pending", { name: "resolved", final: true });
    expect(s.pending.isFinal).toBe(false);
    expect(s.resolved.isFinal).toBe(true);
    expect(s.resolved.name).toBe("resolved");
  });

  test("object entries without final stay non-final", () => {
    const s = states({ name: "waiting" });
    expect(s.waiting.isFinal).toBe(false);
  });

  test("mixes strings and objects", () => {
    const s = states("idle", { name: "done", final: true }, "error");
    expect(s.idle.name).toBe("idle");
    expect(s.done.isFinal).toBe(true);
    expect(s.error.name).toBe("error");
  });

  test("final flag narrows the isFinal type", () => {
    const s = states("pending", { name: "done", final: true });
    expectTypeOf(s.pending).toEqualTypeOf<StateRef<"pending">>();
    expectTypeOf(s.done).toEqualTypeOf<StateRef<"done", unknown, true>>();
    expectTypeOf(s.pending.isFinal).toEqualTypeOf<false>();
    expectTypeOf(s.done.isFinal).toEqualTypeOf<true>();
  });
});
