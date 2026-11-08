import type { VizStep } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  appendNote,
  arrowsOf,
  cleanNoteText,
  copyText,
  isNoteTarget,
  isVizSteps,
  notesFileOf,
  parseNotes,
  parseTarget,
  targetProblem,
  targetText,
} from "./notes.ts";
import type { CopiedNote, MachineShape } from "./notes.ts";

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
  const second = appendNote(first.text, {
    file: "src/retry.ts",
    machine: "retry",
    target: state("lockedOut"),
    note: "lock out only after three tries",
  });
  return appendNote(second.text, {
    file: "src/retry.ts",
    machine: "retry",
    target: { kind: "edge", from: "connecting", event: "failed" },
    note: "count failures only while connecting",
  }).text;
}

const shape: MachineShape = {
  states: [{ id: "s" }, { id: "t" }],
  events: [{ id: "GO" }, { id: "STOP" }],
  edges: [
    { from: "s", event: "GO", kind: "transition" },
    { from: "s", event: "GO", kind: "transition" },
    { from: "*", event: "STOP", kind: "transition" },
    { from: "t", event: "PING", kind: "stay" },
    { from: "s", event: "effect:s", kind: "effect" },
    { from: "__initial__", event: "", kind: "initial" },
  ],
};

describe("notes file", () => {
  test("three appends produce the golden file byte for byte", () => {
    expect(twice()).toBe(golden);
  });

  test("parses the golden file", () => {
    const parsed = parseNotes(golden, "retry.notes.md");
    expect(Either.getRight(parsed)?.map((note) => [note.id, note.target, note.status])).toEqual([
      ["n1", state("connecting"), "open"],
      ["n2", state("lockedOut"), "open"],
      ["n3", { kind: "edge", from: "connecting", event: "failed" }, "open"],
    ]);
  });

  test("parseTarget reads both kinds and round-trips", () => {
    expect(parseTarget("edge a B")).toEqual({
      kind: "edge",
      from: "a",
      event: "B",
    });
    expect(parseTarget("edge a")).toBeUndefined();
    expect(parseTarget("edge a B c")).toBeUndefined();
    for (const target of [state("a"), { kind: "edge", from: "*", event: "finish" } as const]) {
      expect(parseTarget(targetText(target))).toEqual(target);
    }
  });

  test("isNoteTarget accepts edges with word parts only", () => {
    expect(isNoteTarget({ kind: "edge", from: "a", event: "B" })).toBe(true);
    expect(isNoteTarget({ kind: "edge", from: "", event: "B" })).toBe(false);
    expect(isNoteTarget({ kind: "edge", from: "a", event: "a b" })).toBe(false);
    expect(isNoteTarget({ kind: "edge", from: "a" })).toBe(false);
    expect(isNoteTarget({ kind: "arrow", from: "a", event: "B" })).toBe(false);
    expect(isNoteTarget({ kind: "edge", state: "a" })).toBe(false);
  });

  test("targetProblem checks states and arrows against the machine", () => {
    const check = (target: Parameters<typeof targetProblem>[1]["target"]) =>
      targetProblem(shape, { machine: "m", target });
    expect(check(state("s"))).toBeUndefined();
    expect(check({ kind: "edge", from: "s", event: "GO" })).toBeUndefined();
    expect(check({ kind: "edge", from: "*", event: "STOP" })).toBeUndefined();
    expect(check({ kind: "edge", from: "t", event: "PING" })).toBeUndefined();
    expect(check(state("nope"))).toBe("no state nope in m");
    expect(check({ kind: "edge", from: "s", event: "NOPE" })).toBe("no arrow NOPE from s in m");
    expect(check({ kind: "edge", from: "t", event: "GO" })).toBe("no arrow GO from t in m");
    expect(check({ kind: "edge", from: "s", event: "effect:s" })).toBe(
      "no arrow effect:s from s in m",
    );
    expect(arrowsOf(shape, { from: "s", event: "GO" })).toBe(2);
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
    const added = appendNote("", {
      file: "a/b.ts",
      machine: "m",
      target: state("s"),
      note: "n",
    });
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

describe("walk notes", () => {
  const steps = [
    { kind: "event", event: "GO", payload: { n: 1 } },
    { kind: "advance", ms: 3600000 },
  ] as const;

  test("appendNote writes the walk lines and parseNotes reads them back", () => {
    const added = appendNote(undefined, {
      file: "m.ts",
      machine: "m",
      target: { kind: "walk" },
      note: "Nils picks 1 hour",
      walk: { end: "t", steps: [...steps] },
    });
    expect(added.text).toContain(
      '- id: n1\n  machine: m\n  on: walk\n  status: open\n  note: Nils picks 1 hour\n  end: t\n  steps: [{"kind":"event","event":"GO","payload":{"n":1}},{"kind":"advance","ms":3600000}]\n',
    );
    const [note] = Either.getRight(parseNotes(added.text, "m.notes.md")) ?? [];
    expect(note?.target).toEqual({ kind: "walk" });
    expect(note?.end).toBe("t");
    expect(note?.steps).toEqual(steps);
    expect(note).toEqual(added.note);
  });

  test("other notes have no end or steps", () => {
    const [note] = Either.getRight(parseNotes(twice(), "x")) ?? [];
    expect(note?.end).toBeUndefined();
    expect(note?.steps).toBeUndefined();
  });

  test("malformed steps give undefined and do not throw", () => {
    for (const bad of [
      "{oops",
      "{}",
      '[{"kind":"advance","ms":-1}]',
      '[{"kind":"event","event":"","payload":1}]',
      '[{"kind":"event","event":"GO"}]',
      "",
    ]) {
      const text = `mantaq notes v1\n- id: n1\n  on: walk\n  end: t\n  steps: ${bad}\n`;
      const [note] = Either.getRight(parseNotes(text, "x")) ?? [];
      expect(note?.target).toEqual({ kind: "walk" });
      expect(note?.steps).toBeUndefined();
      expect(note?.note).toMatch(/^\[unreadable steps\]/);
    }
  });

  test("a payload with a newline and field-like text stays inside the steps", () => {
    const steps = [{ kind: "event" as const, event: "GO", payload: "a\n  end: x\n- id: n9" }];
    const added = appendNote(undefined, {
      file: "m.ts",
      machine: "m",
      target: { kind: "walk" },
      note: "hi",
      walk: { end: "t", steps },
    });
    const [note] = Either.getRight(parseNotes(added.text, "x")) ?? [];
    expect(note?.end).toBe("t");
    expect(note?.steps).toEqual(steps);
  });

  test("walk target text, parse, guard", () => {
    expect(targetText({ kind: "walk" })).toBe("walk");
    expect(parseTarget("walk")).toEqual({ kind: "walk" });
    expect(isNoteTarget({ kind: "walk" })).toBe(true);
    expect(targetProblem(shape, { machine: "m", target: { kind: "walk" } })).toBeUndefined();
    expect(isVizSteps([])).toBe(true);
    expect(isVizSteps("x")).toBe(false);
  });
});

describe("copyText", () => {
  const walk: { end: string; steps: VizStep[] } = {
    end: "payment",
    steps: [{ kind: "event", event: "PAY", payload: 1 }],
  };

  test("state, edge and walk notes across two files give two groups that parse back", () => {
    const notes: CopiedNote[] = [
      { file: "a.ts", machine: "a", target: state("one"), note: "first" },
      { file: "b.ts", machine: "b", target: { kind: "walk" }, note: "walk it", walk },
      { file: "a.ts", machine: "a", target: { kind: "edge", from: "one", event: "GO" }, note: "x" },
    ];
    const text = copyText(notes);
    expect(text.endsWith("\n")).toBe(true);
    const [first, second] = text.trimEnd().split("\n\n");
    expect(first?.split("\n")[0]).toBe("mantaq notes v1 for a.ts");
    expect(second?.split("\n")[0]).toBe("mantaq notes v1 for b.ts");
    const a = parseNotes(first ?? "", "a.ts");
    const b = parseNotes(second ?? "", "b.ts");
    expect(Either.isRight(a) && a[1].map((each) => each.id)).toEqual(["p1", "p2"]);
    expect(Either.isRight(b) && b[1].map((each) => each.id)).toEqual(["p3"]);
    expect(Either.isRight(a) && a[1].map((each) => each.target)).toEqual([
      state("one"),
      { kind: "edge", from: "one", event: "GO" },
    ]);
    expect(Either.isRight(b) && b[1][0]?.end).toBe("payment");
    expect(Either.isRight(b) && b[1][0]?.steps).toEqual([
      { kind: "event", event: "PAY", payload: 1 },
    ]);
  });

  test("a note with a newline and a tab stays on one line", () => {
    const text = copyText([
      { file: "a.ts", machine: "a", target: state("one"), note: "a\n- id: fake\tb" },
    ]);
    expect(text.split("\n")).toHaveLength(7);
    expect(text).toContain("  note: a - id: fake b\n");
  });

  test("no notes give an empty string", () => {
    expect(copyText([])).toBe("");
  });
});
