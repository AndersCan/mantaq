import { describe, test, expect } from "vite-plus/test";
import { states } from "../src/state.ts";

describe("states directed mutation tests", () => {
  test("string entries and object entries build the same record", () => {
    const a = states("pending", "resolved");
    const b = states("pending", { name: "resolved", final: true });
    expect(a.pending.name).toBe(b.pending.name);
    expect(a.resolved.name).toBe(b.resolved.name);
  });

  test("object final flag controls finality exactly", () => {
    const s = states({ name: "plain", final: false }, { name: "done", final: true }, "bare");
    expect(s.plain.isFinal).toBe(false);
    expect(s.done.isFinal).toBe(true);
    expect(s.bare.isFinal).toBe(false);
  });

  test("empty call yields an empty record", () => {
    const s = states();
    expect(Object.keys(s)).toEqual([]);
  });
});
