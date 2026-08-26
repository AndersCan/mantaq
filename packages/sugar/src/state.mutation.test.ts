import { states } from "./state.ts";
import type { StateRef } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function finalityOf(record: Record<string, StateRef<string, unknown, boolean>>) {
  return Object.fromEntries(
    Object.entries(record).map(([name, ref]) => [name, { name: ref.name, isFinal: ref.isFinal }]),
  );
}

describe("states directed mutation tests", () => {
  test("builds the same record from string entries and object entries with matching flags", () => {
    const fromStrings = states("pending", "resolved");
    const fromObjects = states("pending", { name: "resolved", final: false });
    expect(finalityOf(fromStrings)).toEqual({
      pending: { name: "pending", isFinal: false },
      resolved: { name: "resolved", isFinal: false },
    });
    expect(finalityOf(fromObjects)).toEqual(finalityOf(fromStrings));
  });

  test("sets finality exactly as the object flag declares", () => {
    const refs = states({ name: "plain", final: false }, { name: "done", final: true }, "bare");
    expect(finalityOf(refs)).toEqual({
      plain: { name: "plain", isFinal: false },
      done: { name: "done", isFinal: true },
      bare: { name: "bare", isFinal: false },
    });
  });

  test("returns an empty record for an empty call", () => {
    const refs = states();
    expect(Object.keys(refs)).toEqual([]);
  });
});
