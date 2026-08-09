import { expect, test, describe } from "vite-plus/test";
import { matches } from "../src/actors/matches.ts";
import type { Snapshot } from "@mantaq/core";

function snap(path: string[], regions: Record<string, Snapshot> = {}): Snapshot {
  return { path, context: {}, regions };
}

describe("matches — mutation tests", () => {
  describe("dot separator in join (line 7: .join('.') → .join(''))", () => {
    test("state with dotted name matches dotted pattern", () => {
      const actor = { snapshot: () => snap(["a.b"]) };
      expect(matches(actor, "a.b")).toBe(true);
    });

    test("state with dotted name does not match concatenated form", () => {
      const actor = { snapshot: () => snap(["a.b"]) };
      expect(matches(actor, "ab")).toBe(false);
    });

    test("hierarchical match through region with dotted state name", () => {
      const actor = {
        snapshot: () =>
          snap(["root"], {
            sub: snap(["a.b"]),
          }),
      };
      expect(matches(actor, "root.sub.a.b")).toBe(true);
    });

    test("dotted state name in nested region", () => {
      const actor = {
        snapshot: () =>
          snap(["root"], {
            sub: snap(["mid"], {
              leaf: snap(["x.y"]),
            }),
          }),
      };
      expect(matches(actor, "root.sub.mid.leaf.x.y")).toBe(true);
      expect(matches(actor, "root.sub.mid.leaf.xy")).toBe(false);
    });
  });

  describe("loop boundary (line 6: end < parts.length → end <= parts.length)", () => {
    test("deep 4-level hierarchy matches each prefix", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"], {
              d: snap(["e"], {
                f: snap(["g"]),
              }),
            }),
          }),
      };
      expect(matches(actor, "a")).toBe(true);
      expect(matches(actor, "a.b")).toBe(true);
      expect(matches(actor, "a.b.c")).toBe(true);
      expect(matches(actor, "a.b.c.d")).toBe(true);
      expect(matches(actor, "a.b.c.d.e")).toBe(true);
      expect(matches(actor, "a.b.c.d.e.f")).toBe(true);
      expect(matches(actor, "a.b.c.d.e.f.g")).toBe(true);
    });

    test("pattern exceeding hierarchy depth returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"]),
          }),
      };
      expect(matches(actor, "a.b.c.d")).toBe(false);
      expect(matches(actor, "a.b.c.d.e")).toBe(false);
    });

    test("long pattern with no matching hierarchy", () => {
      const actor = {
        snapshot: () => snap(["only"]),
      };
      expect(matches(actor, "only.a.b.c.d")).toBe(false);
    });
  });

  describe("trailing dot validation (line 24: pattern.endsWith('.'))", () => {
    test("single-segment pattern ending with dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap([""]),
          }),
      };
      expect(matches(actor, "a.")).toBe(false);
    });

    test("multi-segment pattern ending with dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["x"], {
            y: snap([""]),
          }),
      };
      expect(matches(actor, "x.y.")).toBe(false);
    });

    test("deep pattern ending with dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            b: snap(["c"], {
              "": snap([""]),
            }),
          }),
      };
      expect(matches(actor, "a.b.c.")).toBe(false);
    });
  });

  describe("leading dot validation (line 24: pattern.startsWith('.'))", () => {
    test("pattern starting with dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            a: snap(["b"]),
          }),
      };
      expect(matches(actor, ".a")).toBe(false);
    });

    test("multi-segment pattern starting with dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            x: snap(["y"]),
          }),
      };
      expect(matches(actor, ".x.y")).toBe(false);
    });

    test("pattern that is only a dot returns false", () => {
      const actor = { snapshot: () => snap([""]) };
      expect(matches(actor, ".")).toBe(false);
    });
  });

  describe("double dot validation (line 24: pattern.includes('..'))", () => {
    test("pattern with double dot in middle returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"]),
          }),
      };
      expect(matches(actor, "a..b")).toBe(false);
    });

    test("pattern that is just double dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap([""], {
            "": snap([""]),
          }),
      };
      expect(matches(actor, "..")).toBe(false);
    });

    test("longer pattern with double dot returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"], {
              c: snap(["d"]),
            }),
          }),
      };
      expect(matches(actor, "a..b.c")).toBe(false);
    });

    test("pattern with multiple double dots returns false", () => {
      const actor = {
        snapshot: () =>
          snap(["a"], {
            "": snap(["b"]),
          }),
      };
      expect(matches(actor, "a..b..c")).toBe(false);
    });
  });

  describe("null/undefined/empty pattern validation (line 24: !pattern)", () => {
    test("null pattern returns false", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, null as unknown as string)).toBe(false);
    });

    test("undefined pattern returns false", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, undefined as unknown as string)).toBe(false);
    });

    test("empty string pattern returns false", () => {
      const actor = { snapshot: () => snap(["idle"]) };
      expect(matches(actor, "")).toBe(false);
    });
  });
});
