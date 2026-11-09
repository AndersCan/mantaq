import { describe, expect, test } from "vite-plus/test";
import { addedLines } from "./added-lines.ts";

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
});
