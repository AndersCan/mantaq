import { Either } from "@mantaq/utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  appendNote,
  cleanNoteText,
  isNoteTarget,
  notesFileOf,
  parseNotes,
  parseTarget,
  targetText,
} from "./notes.ts";

const golden = readFileSync(join(import.meta.dirname, "fixtures", "retry.notes.md"), "utf8");

function state(name: string) {
  return { kind: "state", state: name } as const;
}

function twice(): string {
  const first = appendNote(undefined, {
    file: "src/retry.ts",
    machine: "retry",
    target: state("connecting"),
    note: "needs a cancel",
  });
  return appendNote(first.text, {
    file: "src/retry.ts",
    machine: "retry",
    target: state("lockedOut"),
    note: "lock out only after three tries",
  }).text;
}

describe("notes file", () => {
  test("two appends produce the golden file byte for byte", () => {
    expect(twice()).toBe(golden);
  });

  test("parses the golden file", () => {
    const parsed = parseNotes(golden, "retry.notes.md");
    expect(Either.getRight(parsed)?.map((note) => [note.id, note.target, note.status])).toEqual([
      ["n1", state("connecting"), "open"],
      ["n2", state("lockedOut"), "open"],
    ]);
  });

  test("parses a hand-edited file", () => {
    const text = [
      "# Notes",
      "",
      "- id: a",
      "  machine: m",
      "  on: state s",
      "  status:  Done ",
      "  note: x",
      "  result: added cancel",
      "  priority: high",
      "",
      "",
      "- id: b",
      "  on: somewhere",
      "  note: y",
      "  question: which one?",
      "  status: maybe",
    ].join("\r\n");
    expect(Either.getRight(parseNotes(text, "f.notes.md"))).toEqual([
      {
        id: "a",
        machine: "m",
        on: "state s",
        target: state("s"),
        status: "done",
        note: "x",
        result: "added cancel",
        question: undefined,
      },
      {
        id: "b",
        machine: undefined,
        on: "somewhere",
        target: undefined,
        status: "open",
        note: "y",
        result: undefined,
        question: "which one?",
      },
    ]);
  });

  test("a newer version is refused, no version line means v1", () => {
    expect(Either.getLeft(parseNotes("mantaq notes v2\n- id: n1\n", "x.notes.md"))).toBe(
      "x.notes.md is mantaq notes v2; update @mantaq/inspect",
    );
    expect(Either.getRight(parseNotes("- id: n1\n  note: a\n", "x"))?.length).toBe(1);
  });

  test("ids continue from the largest n<k>, and a missing newline is added", () => {
    const existing = "- id: n2\n  note: a\n- id: n9\n- id: x1";
    const added = appendNote(existing, {
      file: "a.ts",
      machine: "m",
      target: state("s"),
      note: "b",
    });
    expect(added.note.id).toBe("n10");
    expect(added.text.startsWith(`${existing}\n- id: n10\n`)).toBe(true);
  });

  test("an empty existing file gets the header", () => {
    const added = appendNote("", { file: "a/b.ts", machine: "m", target: state("s"), note: "n" });
    expect(added.text.startsWith("# Notes on b.ts\n\nmantaq notes v1.")).toBe(true);
  });

  test("note text is one clean line", () => {
    expect(cleanNoteText("  a\n\tb\u0007 ")).toBe("a b");
  });

  test("notesFileOf replaces the extension", () => {
    expect(notesFileOf("src/a.ts")).toBe("src/a.notes.md");
    expect(notesFileOf("src/checkout.machine.ts")).toBe("src/checkout.machine.notes.md");
    expect(notesFileOf("x/f.mjs")).toBe("x/f.notes.md");
    expect(notesFileOf("x/grants-machine.ts")).toBe("x/grants-machine.notes.md");
    expect(notesFileOf("x/readme")).toBe("x/readme.notes.md");
  });

  test("targets round trip, and bad ones are rejected", () => {
    expect(parseTarget(targetText(state("a")))).toEqual(state("a"));
    expect(parseTarget("state a b")).toBeUndefined();
    expect(isNoteTarget(state("a"))).toBe(true);
    expect(isNoteTarget(state("a b"))).toBe(false);
    expect(isNoteTarget({ kind: "edge", state: "a" })).toBe(false);
    expect(isNoteTarget(undefined)).toBe(false);
  });
});
