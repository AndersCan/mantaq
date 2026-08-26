import { activeLeaves } from "./snapshot.ts";
import type { Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function snap(...args: [path: string[], regions?: Record<string, Snapshot>]): Snapshot {
  const [path, regions] = args;
  return { path, context: {}, regions: regions ?? {} };
}

describe("activeLeaves mutation guard", () => {
  test("returns a dotted join for multi-element paths", () => {
    const snapshot = snap(["a", "b"]);
    expect(activeLeaves(snapshot)).toEqual(["a.b"]);
  });

  test("returns a region-prefixed dotted join inside regions", () => {
    const snapshot = snap(["parent"], {
      child: snap(["x", "y"]),
    });
    expect(activeLeaves(snapshot)).toEqual(["parent.child.x.y"]);
  });

  test("returns one dotted leaf per region for parallel multi-element paths", () => {
    const snapshot = snap(["machine"], {
      a: snap(["on", "fast"]),
      b: snap(["off", "slow"]),
    });
    expect(activeLeaves(snapshot)).toEqual(["machine.a.on.fast", "machine.b.off.slow"]);
  });
});
