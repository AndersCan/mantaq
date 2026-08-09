import { describe, test, expect } from "vite-plus/test";
import type { Snapshot } from "@mantaq/core";
import { activeLeaves } from "../src/index.ts";

function snap(path: string[], regions: Record<string, Snapshot> = {}): Snapshot {
  return { path, context: {}, regions };
}

describe("activeLeaves mutation guard", () => {
  test("joins multi-element path with dots", () => {
    const s = snap(["a", "b"]);
    expect(activeLeaves(s)).toEqual(["a.b"]);
  });

  test("joins multi-element path with dots inside region", () => {
    const s = snap(["parent"], {
      child: snap(["x", "y"]),
    });
    expect(activeLeaves(s)).toEqual(["parent.child.x.y"]);
  });

  test("multiple leaf regions with multi-element paths", () => {
    const s = snap(["machine"], {
      a: snap(["on", "fast"]),
      b: snap(["off", "slow"]),
    });
    expect(activeLeaves(s)).toEqual(["machine.a.on.fast", "machine.b.off.slow"]);
  });
});
