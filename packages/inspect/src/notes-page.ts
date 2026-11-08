/**
 * What the note box of the live page shares: reading the dev-server notes
 * endpoint, posting a note, and the note list for a state or arrow.
 */
import { isAnyState } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import type { ViewerSelection } from "@mantaq/viz/viewer";
import { NOTES_VERSION, isNoteTarget, targetText } from "./notes.ts";
import type { Note, NoteTarget } from "./notes.ts";

export type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "refused"; message: string }
  | { kind: "showing"; file: string; exists: boolean; notes: Note[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNote(value: unknown): Note | undefined {
  if (!isRecord(value)) return undefined;
  const { id, machine, on, target, status, note, result, question } = value;
  if (typeof id !== "string" || typeof note !== "string") return undefined;
  return {
    id,
    machine: typeof machine === "string" ? machine : undefined,
    on: typeof on === "string" ? on : "",
    target: isNoteTarget(target) ? target : undefined,
    status: status === "done" ? "done" : "open",
    note,
    result: typeof result === "string" ? result : undefined,
    question: typeof question === "string" ? question : undefined,
  };
}

function readNotes(value: unknown): Note[] {
  return Array.isArray(value) ? value.flatMap((each) => readNote(each) ?? []) : [];
}

async function errorText(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  const error = isRecord(body) ? body["error"] : undefined;
  return typeof error === "string" ? error : `the dev server answered ${response.status}`;
}

/** The saved note, or the reason it was not saved. */
export async function post(
  url: string,
  body: string,
): Promise<string | { file: string; note: Note }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(() => undefined);
  if (response === undefined) return "the dev server did not answer";
  if (!response.ok) return errorText(response);
  const answer: unknown = await response.json().catch(() => undefined);
  const note = isRecord(answer) ? readNote(answer["note"]) : undefined;
  const file = isRecord(answer) ? answer["file"] : undefined;
  return note === undefined || typeof file !== "string"
    ? "the dev server sent an unreadable answer"
    : { file, note };
}

export async function fetchPhase(url: string, machine: string): Promise<Phase> {
  const response = await fetch(`${url}?machine=${encodeURIComponent(machine)}`).catch(
    () => undefined,
  );
  if (response === undefined) return { kind: "unavailable" };
  if (response.status === 409) return { kind: "refused", message: await errorText(response) };
  if (!response.ok) return { kind: "unavailable" };
  const body: unknown = await response.json().catch(() => undefined);
  if (!isRecord(body)) return { kind: "unavailable" };
  if (body["version"] !== NOTES_VERSION) {
    return { kind: "refused", message: "Notes need a page reload." };
  }
  return {
    kind: "showing",
    file: typeof body["file"] === "string" ? body["file"] : "",
    exists: body["exists"] === true,
    notes: readNotes(body["notes"]),
  };
}

function key(target: NoteTarget | undefined): string {
  return target === undefined ? "" : targetText(target);
}

function word(value: string): boolean {
  return /^\S+$/.test(value);
}

/** What a click can carry a note: a state, or an arrow a handler draws. */
export function targetOf(
  selection: ViewerSelection | undefined,
  machine: VizMachine,
): NoteTarget | undefined {
  if (selection?.kind === "state") {
    return word(selection.id) && !isAnyState(selection.id)
      ? { kind: "state", state: selection.id }
      : undefined;
  }
  if (selection?.kind !== "edge") return undefined;
  const edge = machine.edges.find((each) => each.id === selection.id);
  if (edge === undefined || (edge.kind !== "transition" && edge.kind !== "stay")) return undefined;
  return word(edge.from) && word(edge.event)
    ? { kind: "edge", from: edge.from, event: edge.event }
    : undefined;
}

export function targetLabel(target: NoteTarget): string {
  if (target.kind === "state") return target.state;
  return `${target.event} from ${isAnyState(target.from) ? "any state" : target.from}`;
}

function noteItem(doc: Document, each: Note): HTMLLIElement {
  const item = doc.createElement("li");
  item.dataset["noteId"] = each.id;
  item.dataset["status"] = each.status;
  const flag = doc.createElement("strong");
  flag.textContent = each.status === "done" ? "Done" : "Open";
  item.append(flag, ` ${each.note}`);
  for (const line of [
    result(doc, "Result: ", each.result),
    result(doc, "Question: ", each.question),
  ]) {
    if (line !== undefined) item.append(line);
  }
  return item;
}

export function noteList(
  doc: Document,
  target: NoteTarget,
  notes: Note[],
): HTMLElement | undefined {
  const mine = notes.filter((each) => key(each.target) === key(target));
  if (mine.length === 0) return undefined;
  const list = doc.createElement("ul");
  list.className = "notes-list";
  for (const each of mine) list.append(noteItem(doc, each));
  return list;
}

function result(doc: Document, label: string, value: string | undefined): HTMLElement | undefined {
  if (value === undefined) return undefined;
  const line = doc.createElement("p");
  line.textContent = `${label}${value}`;
  return line;
}
