/**
 * The notes file (`mantaq notes v1`): notes left on a state in the live page,
 * saved as a Markdown list next to the machine file. Pure text in, text out,
 * so the page and the dev server share it.
 */
import { Either } from "@mantaq/utils";

export const NOTES_VERSION = 1;
export const MAX_NOTE_LENGTH = 2000;

export type NoteTarget =
  | { kind: "state"; state: string }
  | { kind: "edge"; from: string; event: string };

/** What a target is checked against; a VizMachine satisfies it. */
export interface MachineShape {
  states: ReadonlyArray<{ id: string }>;
  edges: ReadonlyArray<{ from: string; event: string; kind: string }>;
}

export interface Note {
  id: string;
  /** `undefined` = the note belongs to every machine of the file. */
  machine: string | undefined;
  /** The raw `on:` value, `""` when missing. */
  on: string;
  /** `undefined` = the `on:` value is missing or unreadable. */
  target: NoteTarget | undefined;
  status: "open" | "done";
  note: string;
  result: string | undefined;
  question: string | undefined;
}

export interface NotesList {
  version: 1;
  file: string;
  exists: boolean;
  notes: Note[];
}

export interface NoteAdded {
  version: 1;
  file: string;
  note: Note;
}

const MACHINE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const VERSION_LINE = /^mantaq notes v(\d+)\b/;
const ITEM_LINE = /^- id: ?(.*)$/;
const FIELD_LINE = /^ {2}(machine|on|status|note|result|question): ?(.*)$/;
const GENERATED_ID = /^n(\d+)$/;

/** `src/checkout.machine.ts` → `src/checkout.machine.notes.md`. */
export function notesFileOf(machineFile: string): string {
  return `${machineFile.replace(MACHINE_EXTENSION, "")}.notes.md`;
}

export function targetText(target: NoteTarget): string {
  return target.kind === "state" ? `state ${target.state}` : `edge ${target.from} ${target.event}`;
}

export function parseTarget(text: string): NoteTarget | undefined {
  const trimmed = text.trim();
  const state = /^state (\S+)$/.exec(trimmed);
  if (state !== null) return { kind: "state", state: state[1] ?? "" };
  const edge = /^edge (\S+) (\S+)$/.exec(trimmed);
  return edge === null ? undefined : { kind: "edge", from: edge[1] ?? "", event: edge[2] ?? "" };
}

function isWord(value: unknown): value is string {
  return typeof value === "string" && /^\S+$/.test(value);
}

export function isNoteTarget(value: unknown): value is NoteTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; state?: unknown; from?: unknown; event?: unknown };
  if (candidate.kind === "state") return isWord(candidate.state);
  return candidate.kind === "edge" && isWord(candidate.from) && isWord(candidate.event);
}

/** Edges of kind transition or stay with this from and event (the arrows one handler draws). */
export function arrowsOf(shape: MachineShape, target: { from: string; event: string }): number {
  return shape.edges.filter(
    (edge) =>
      edge.from === target.from &&
      edge.event === target.event &&
      (edge.kind === "transition" || edge.kind === "stay"),
  ).length;
}

/** Undefined = the machine has the target; else the 404 error text. */
export function targetProblem(
  shape: MachineShape,
  input: { machine: string; target: NoteTarget },
): string | undefined {
  const { target, machine } = input;
  if (target.kind === "state") {
    return shape.states.some((state) => state.id === target.state)
      ? undefined
      : `no state ${target.state} in ${machine}`;
  }
  return arrowsOf(shape, target) > 0
    ? undefined
    : `no arrow ${target.event} from ${target.from} in ${machine}`;
}

/** One line: control characters become spaces, whitespace runs collapse, ends trimmed. */
export function cleanNoteText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

function versionOf(text: string): number {
  for (const line of lines(text)) {
    const found = VERSION_LINE.exec(line);
    if (found !== null) return Number(found[1]);
  }
  return NOTES_VERSION;
}

function versionMessage(file: string, version: number): string {
  return `${file} is mantaq notes v${version}; update @mantaq/inspect`;
}

/** Left = the version message, when the file is newer than this reader. */
export function parseNotes(text: string, file: string): Either<string, Note[]> {
  const version = versionOf(text);
  if (version !== NOTES_VERSION) return Either.left(versionMessage(file, version));
  const items: Array<Record<string, string>> = [];
  for (const line of lines(text)) {
    const start = ITEM_LINE.exec(line);
    if (start !== null) {
      items.push({ id: (start[1] ?? "").trim() });
      continue;
    }
    const field = FIELD_LINE.exec(line);
    const current = items[items.length - 1];
    if (field !== null && current !== undefined) current[field[1] ?? ""] = (field[2] ?? "").trim();
  }
  return Either.right<Note[]>(
    items.map((item): Note => ({
      id: item["id"] ?? "",
      machine: item["machine"] === "" ? undefined : item["machine"],
      on: item["on"] ?? "",
      target: parseTarget(item["on"] ?? ""),
      status: (item["status"] ?? "").toLowerCase() === "done" ? "done" : "open",
      note: item["note"] ?? "",
      result: item["result"],
      question: item["question"],
    })),
  );
}

function nextId(existing: string): string {
  let largest = 0;
  for (const line of lines(existing)) {
    const id = GENERATED_ID.exec((ITEM_LINE.exec(line)?.[1] ?? "").trim());
    if (id !== null) largest = Math.max(largest, Number(id[1]));
  }
  return `n${largest + 1}`;
}

/**
 * Appends one open note. Existing bytes are kept as they are. `file` is the
 * machine file, whose basename names a new notes file's header.
 */
export function appendNote(
  existing: string | undefined,
  input: { file: string; machine: string; target: NoteTarget; note: string },
): { text: string; note: Note } {
  const id = nextId(existing ?? "");
  const on = targetText(input.target);
  const item = [
    `- id: ${id}`,
    `  machine: ${input.machine}`,
    `  on: ${on}`,
    "  status: open",
    `  note: ${input.note}`,
    "",
  ].join("\n");
  const basename = input.file.split(/[\\/]/).pop() ?? input.file;
  const header = `# Notes on ${basename}\n\nmantaq notes v${NOTES_VERSION}. Written by the live viz page. Your coding agent applies the notes with status: open and then sets them to done.\n\n`;
  const text =
    existing === undefined || existing === ""
      ? header + item
      : (existing.endsWith("\n") ? existing : `${existing}\n`) + item;
  return {
    text,
    note: {
      id,
      machine: input.machine,
      on,
      target: input.target,
      status: "open",
      note: input.note,
      result: undefined,
      question: undefined,
    },
  };
}
