/**
 * The notes section of the live page: under the panel, for the selected
 * state or arrow, the notes already left on it and a box to add one. It talks to the
 * dev-server endpoint and stays hidden when that does not answer (static
 * hosts, older servers, visitors from another computer).
 */
import { isAnyState } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import type { ViewerSelection } from "@mantaq/viz/viewer";
import {
  NOTES_VERSION,
  MAX_NOTE_LENGTH,
  arrowsOf,
  isNoteTarget,
  isVizSteps,
  targetText,
} from "./notes.ts";
import type { Note, NoteTarget } from "./notes.ts";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "refused"; message: string }
  | { kind: "showing"; file: string; exists: boolean; notes: Note[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNote(value: unknown): Note | undefined {
  if (!isRecord(value)) return undefined;
  const { id, machine, on, target, status, note, result, question, end, steps } = value;
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
    end: typeof end === "string" ? end : undefined,
    steps: isVizSteps(steps) ? steps : undefined,
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
async function post(url: string, body: string): Promise<string | { file: string; note: Note }> {
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

async function fetchPhase(url: string, machine: string): Promise<Phase> {
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

/** The footer for the viewer's `panelFooter`: one persistent section, rebuilt only when it must change. */
export function notesFooter(
  doc: Document,
  context: { url: string; machine: VizMachine },
): (selection: ViewerSelection | undefined) => Node | undefined {
  const section = doc.createElement("section");
  section.className = "notes";
  section.hidden = true;
  let phase: Phase = { kind: "loading" };
  let target: NoteTarget | undefined;
  let status = "";
  let saving = false;
  let draft = "";
  let justSaved = false;

  const render = () => {
    section.hidden = true;
    section.replaceChildren();
    if (phase.kind === "loading" || phase.kind === "unavailable") return;
    section.hidden = false;
    const statusLine = doc.createElement("p");
    statusLine.className = "notes-status";
    statusLine.setAttribute("role", "status");
    statusLine.textContent = phase.kind === "refused" ? phase.message : status;
    if (phase.kind === "refused" || target === undefined) {
      if (phase.kind === "refused") section.append(statusLine);
      else section.hidden = true;
      return;
    }
    const label = targetLabel(target);
    const heading = doc.createElement("h3");
    heading.textContent = `Notes on ${label}`;
    section.append(heading);
    if (target.kind === "edge") {
      const shared = arrowsOf(context.machine, target);
      if (shared > 1) {
        const hint = doc.createElement("p");
        hint.className = "hint";
        hint.textContent = `The ${shared} arrows for ${label} share these notes.`;
        section.append(hint);
      }
    }
    section.append(noteList(doc, target, phase.notes));
    section.append(form(target), statusLine);
    if (phase.exists || justSaved) {
      const where = doc.createElement("p");
      where.className = "notes-file";
      where.textContent = `Saved in ${phase.file}`;
      section.append(where);
    }
  };

  const form = (forTarget: NoteTarget): HTMLFormElement => {
    const element = doc.createElement("form");
    const label = doc.createElement("label");
    label.textContent = "Add a note";
    const field = doc.createElement("textarea");
    field.rows = 3;
    field.maxLength = MAX_NOTE_LENGTH;
    field.style.cssText = "width:100%;box-sizing:border-box";
    field.value = draft;
    field.readOnly = saving;
    label.append(field);
    const button = doc.createElement("button");
    button.type = "submit";
    button.textContent = saving ? "Saving..." : "Save note";
    button.disabled = saving || field.value.trim() === "";
    field.addEventListener("input", () => {
      draft = field.value;
      button.disabled = saving || draft.trim() === "";
    });
    element.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!saving && draft.trim() !== "") void save(forTarget, draft);
    });
    element.append(label, button);
    return element;
  };

  const save = async (forTarget: NoteTarget, text: string) => {
    saving = true;
    justSaved = false;
    status = "";
    render();
    const body = JSON.stringify({
      version: NOTES_VERSION,
      machine: context.machine.id,
      target: forTarget,
      note: text,
    });
    const reason = await post(context.url, body);
    saving = false;
    if (typeof reason === "string") {
      status = `Could not save this note: ${reason}. Your text is still here.`;
    } else if (phase.kind === "showing") {
      phase = { ...phase, exists: true, file: reason.file, notes: [...phase.notes, reason.note] };
      draft = "";
      justSaved = true;
      status = "Note saved";
    }
    render();
  };

  const load = async () => {
    phase = await fetchPhase(context.url, context.machine.id);
    render();
  };
  void load();

  return (selection) => {
    const next = targetOf(selection, context.machine);
    if (key(next) !== key(target)) {
      target = next;
      draft = "";
      status = "";
      justSaved = false;
      render();
    }
    return section;
  };
}

export function key(target: NoteTarget | undefined): string {
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
  if (target.kind === "walk") return "this journey";
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

function noteList(doc: Document, target: NoteTarget, notes: Note[]): HTMLElement {
  const mine = notes.filter((each) => key(each.target) === key(target));
  if (mine.length === 0) {
    const hint = doc.createElement("p");
    hint.className = "hint";
    hint.textContent = `No notes on ${targetLabel(target)} yet.`;
    return hint;
  }
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
