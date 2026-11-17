import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { addedLines, shownStep } from "./added-lines.ts";

describe("shownStep", () => {
  test("drops the step number from names", () => {
    expect(shownStep("const meal3 = 1; meal3.x; meal10; xmeal3")).toBe(
      "const meal = 1; meal.x; meal10; xmeal3",
    );
  });
});

describe("addedLines", () => {
  test("identical text has no added lines", () => {
    expect(addedLines("a\nb", "a\nb")).toEqual([]);
  });
  test("an appended line", () => {
    expect(addedLines("a\nb", "a\nb\nc")).toEqual([3]);
  });
  test("an inserted middle line", () => {
    expect(addedLines("a\nc", "a\nb\nc")).toEqual([2]);
  });
  test("a changed line counts as added", () => {
    expect(addedLines("a\nb\nc", "a\nB\nc")).toEqual([2]);
  });
  test("trailing spaces are ignored", () => {
    expect(addedLines("a  \nb", "a\nb  ")).toEqual([]);
  });
  test("a removed line adds nothing", () => {
    expect(addedLines("a\nb\nc", "a\nc")).toEqual([]);
  });
  test("everything is added when nothing is shared", () => {
    expect(addedLines("x", "a\nb")).toEqual([1, 2]);
  });
  test("a swap marks the line that moved", () => {
    expect(addedLines("a\nb", "b\na")).toEqual([2]);
  });
  test("tutorial page 3 highlights exactly what step 3 adds", () => {
    const shown = (name: string) =>
      shownStep(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
    expect(addedLines(shown("meal-02.ts"), shown("meal-03.ts"))).toEqual([
      1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
    ]);
  });
});
