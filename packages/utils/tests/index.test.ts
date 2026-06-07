import { expect, test, describe } from "vite-plus/test";
import { statePath, isDone, flattenSnapshot } from "../src/index.ts";
import type { Snapshot } from "@mantaq/core";

function snap(path: string[], regions: Record<string, Snapshot> = {}, done?: boolean): Snapshot {
  const s: Snapshot = { path, regions };
  if (done) s.done = true;
  return s;
}

describe("statePath", () => {
  test("flat state", () => {
    expect(statePath(snap(["idle"]))).toBe("idle");
  });

  test("nested state", () => {
    expect(statePath(snap(["connected", "active"]))).toBe("connected.active");
  });
});

describe("isDone", () => {
  test("returns false when done is undefined", () => {
    expect(isDone(snap(["idle"]))).toBe(false);
  });

  test("returns true when done is true", () => {
    expect(isDone(snap(["success"], {}, true))).toBe(true);
  });
});

describe("flattenSnapshot", () => {
  test("flat snapshot returns itself", () => {
    expect(flattenSnapshot(snap(["idle"]))).toEqual([{ path: ["idle"], regions: {} }]);
  });

  test("nested snapshot flattens regions", () => {
    const s = snap(["root"], {
      a: snap(["child"]),
    });
    expect(flattenSnapshot(s)).toHaveLength(2);
    expect(flattenSnapshot(s)[0].path[0]).toBe("root");
    expect(flattenSnapshot(s)[1].path[0]).toBe("child");
  });
});
