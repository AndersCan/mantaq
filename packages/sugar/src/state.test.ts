import { states } from "./state.ts";
import { isStateRef } from "@mantaq/core";
import type { StateRef } from "@mantaq/core";
import { expect, expectTypeOf, test, describe } from "vite-plus/test";

function finalityOf(record: Record<string, StateRef<string, unknown, boolean>>) {
  return Object.fromEntries(
    Object.entries(record).map(([name, ref]) => [name, { name: ref.name, isFinal: ref.isFinal }]),
  );
}

describe("states", () => {
  test("creates multiple state refs keyed by the given names", () => {
    const refs = states("idle", "loading", "success");
    expect(finalityOf(refs)).toEqual({
      idle: { name: "idle", isFinal: false },
      loading: { name: "loading", isFinal: false },
      success: { name: "success", isFinal: false },
    });
    expect(isStateRef(refs.idle)).toBe(true);
  });

  test("returns empty record for no names", () => {
    const refs = states();
    expect(refs).toEqual({});
  });

  test("creates distinct refs for each name", () => {
    const refs = states("a", "b");
    expect(refs.a).not.toBe(refs.b);
  });

  test("creates a working record from a single name", () => {
    const refs = states("idle");
    expect(finalityOf(refs)).toEqual({ idle: { name: "idle", isFinal: false } });
    expect(isStateRef(refs.idle)).toBe(true);
  });

  test("keeps final() usable on returned refs", () => {
    const refs = states("pending", "resolved");
    const final = refs.resolved.final();
    expect({ name: final.name, isFinal: final.isFinal }).toEqual({
      name: "resolved",
      isFinal: true,
    });
  });

  test("returns inline finality from object entries", () => {
    const refs = states("pending", { name: "resolved", final: true });
    expect(finalityOf(refs)).toEqual({
      pending: { name: "pending", isFinal: false },
      resolved: { name: "resolved", isFinal: true },
    });
  });

  test("treats object entries without final as non-final", () => {
    const refs = states({ name: "waiting" });
    expect(finalityOf(refs)).toEqual({ waiting: { name: "waiting", isFinal: false } });
  });

  test("keeps string and object entries in one record", () => {
    const refs = states("idle", { name: "done", final: true }, "error");
    expect(finalityOf(refs)).toEqual({
      idle: { name: "idle", isFinal: false },
      done: { name: "done", isFinal: true },
      error: { name: "error", isFinal: false },
    });
  });

  test("resolves the isFinal type from the final flag", () => {
    const refs = states("pending", { name: "done", final: true });
    expectTypeOf(refs.pending).toEqualTypeOf<StateRef<"pending">>();
    expectTypeOf(refs.done).toEqualTypeOf<StateRef<"done", unknown, true>>();
    expectTypeOf(refs.pending.isFinal).toEqualTypeOf<false>();
    expectTypeOf(refs.done.isFinal).toEqualTypeOf<true>();
  });
});
