import { bannerParts } from "./banner.ts";
import type { BannerFinding } from "./banner.ts";
import { describe, expect, test } from "vite-plus/test";

const f = (title: string, over: Partial<BannerFinding> = {}): BannerFinding => ({
  machine: "m",
  title,
  state: "s",
  event: null,
  ...over,
});

describe("bannerParts", () => {
  test("more than six findings shows six headlines and 'and N more'", () => {
    const parts = bannerParts(Array.from({ length: 9 }, (_, i) => f(`t${i}`)));
    expect(parts.count).toBe(9);
    expect(parts.shown).toEqual(["t0", "t1", "t2", "t3", "t4", "t5"]);
    expect(parts.more).toBe("; and 3 more");
  });

  test("exactly six findings has no 'more'", () => {
    const parts = bannerParts(Array.from({ length: 6 }, (_, i) => f(`t${i}`)));
    expect(parts.shown).toHaveLength(6);
    expect(parts.more).toBe("");
  });

  test("seven findings says 'and 1 more'", () => {
    const parts = bannerParts(Array.from({ length: 7 }, (_, i) => f(`t${i}`)));
    expect(parts.more).toBe("; and 1 more");
  });

  test("machines are joined with commas and 'and', deduplicated", () => {
    expect(bannerParts([f("a", { machine: "a" }), f("b", { machine: "b" })]).machines).toBe(
      "a and b",
    );
    expect(
      bannerParts([
        f("1", { machine: "a" }),
        f("2", { machine: "b" }),
        f("3", { machine: "c" }),
        f("4", { machine: "a" }),
      ]).machines,
    ).toBe("a, b and c");
  });

  test("a state finding plus an event-level finding sets both parts", () => {
    const parts = bannerParts([f("x"), f("y", { state: null, event: "go" })]);
    expect(parts.marked).toBe(true);
    expect(parts.wide).toEqual(["go"]);
    expect(parts.wideText).toBe("go is");
  });

  test("several event-level findings use 'are'", () => {
    const parts = bannerParts([
      f("x", { state: null, event: "a" }),
      f("y", { state: null, event: "b" }),
    ]);
    expect(parts.marked).toBe(false);
    expect(parts.wideText).toBe("a and b are");
  });

  test("notes are not counted", () => {
    const parts = bannerParts([f("x", { note: true })]);
    expect(parts.count).toBe(0);
    expect(parts.wideText).toBe("");
  });
});
