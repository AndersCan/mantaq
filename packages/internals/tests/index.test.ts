import { expect, test, describe } from "vite-plus/test";
import {
  statePath,
  isDone,
  flattenSnapshot,
  noop,
  assertNever,
  createDeferred,
} from "../src/index.ts";
import type { Snapshot } from "@mantaq/core";

function snap(path: string[], regions: Record<string, Snapshot> = {}, done?: boolean): Snapshot {
  const s: Snapshot = { path, regions };
  if (done !== undefined) s.done = done;
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

  test("returns false when done is explicitly false", () => {
    expect(isDone(snap(["idle"], {}, false))).toBe(false);
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

describe("noop", () => {
  test("returns undefined", () => {
    expect(noop()).toBeUndefined();
  });

  test("callable without error", () => {
    expect(() => noop()).not.toThrow();
  });
});

describe("assertNever", () => {
  test("throws on call", () => {
    expect(() => assertNever("anything" as never)).toThrow("Unexpected value: anything");
  });

  test("throws with stringified value", () => {
    expect(() => assertNever("x" as never)).toThrow("Unexpected value: x");
  });

  test("throws with number", () => {
    expect(() => assertNever(42 as never)).toThrow("Unexpected value: 42");
  });
});

describe("createDeferred", () => {
  test("resolve resolves promise", async () => {
    const d = createDeferred<number>();
    d.resolve(42);
    await expect(d.promise).resolves.toBe(42);
  });

  test("reject rejects promise", async () => {
    const d = createDeferred();
    d.reject(new Error("boom"));
    await expect(d.promise).rejects.toThrow("boom");
  });

  test("resolve after creation works", () => {
    const d = createDeferred<string>();
    d.resolve("hello");
  });
});
