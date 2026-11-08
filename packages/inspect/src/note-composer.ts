/**
 * Notes on the live page: right-click a state or an arrow and a box opens at
 * the pointer. On the dev server the note is saved next to the machine file;
 * on a hosted page it is copied as a block for the user to paste into chat.
 */
import type { VizMachine } from "@mantaq/viz";
import { MAX_NOTE_LENGTH, NOTES_VERSION, copyText, targetText } from "./notes.ts";
import type { NoteTarget } from "./notes.ts";
import { fetchPhase, noteList, post, targetLabel, targetOf } from "./notes-page.ts";
import type { Phase } from "./notes-page.ts";

export type NoteAction = { kind: "save"; url: string } | { kind: "copy"; file: string };

interface Point {
  x: number;
  y: number;
}

/** What one viewer remembers between right-clicks. */
interface Session {
  viewer: HTMLElement;
  doc: Document;
  machine: VizMachine;
  action: NoteAction;
  phase: Phase;
  box: HTMLElement | undefined;
  toast: HTMLElement | undefined;
  toastTimer: ReturnType<typeof setTimeout> | undefined;
  stopOutside: (() => void) | undefined;
}

interface Form {
  target: NoteTarget;
  at: Point;
  field: HTMLTextAreaElement;
  status: HTMLElement;
  button: HTMLButtonElement;
}

const TOAST_MS = 2000;
const EDGE = 8;
const LOOK =
  "z-index:3;box-sizing:border-box;background:var(--state-bg);color:var(--fg);border:1px solid var(--accent);border-radius:6px;box-shadow:0 4px 16px rgb(0 0 0 / 25%)";

function closeBox(session: Session): void {
  session.box?.remove();
  session.box = undefined;
  session.stopOutside?.();
  session.stopOutside = undefined;
}

function clearToast(session: Session): void {
  if (session.toastTimer !== undefined) clearTimeout(session.toastTimer);
  session.toast?.remove();
  session.toast = undefined;
}

function place(session: Session, options: { element: HTMLElement; at: Point }): void {
  const { element, at } = options;
  const view = session.doc.defaultView;
  const rect = element.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(at.x, (view?.innerWidth ?? 0) - rect.width - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, (view?.innerHeight ?? 0) - rect.height - EDGE));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function showToast(session: Session, options: { text: string; at: Point }): void {
  clearToast(session);
  const element = session.doc.createElement("p");
  element.setAttribute("role", "status");
  element.dataset["noteToast"] = "";
  element.style.cssText = `position:fixed;width:max-content;max-width:calc(100vw - 16px);margin:0;padding:8px;${LOOK}`;
  element.textContent = options.text;
  session.viewer.append(element);
  place(session, { element, at: options.at });
  session.toast = element;
  session.toastTimer = setTimeout(() => clearToast(session), TOAST_MS);
}

async function save(session: Session, form: Form): Promise<void> {
  if (session.action.kind !== "save") return;
  const body = JSON.stringify({
    version: NOTES_VERSION,
    machine: session.machine.id,
    target: form.target,
    note: form.field.value,
  });
  const reason = await post(session.action.url, body);
  if (typeof reason === "string") {
    form.status.textContent = `Could not save this note: ${reason}. Your text is still here.`;
    return;
  }
  if (session.phase.kind === "showing") {
    session.phase = { ...session.phase, notes: [...session.phase.notes, reason.note] };
  }
  closeBox(session);
  showToast(session, { text: `Saved in ${reason.file}`, at: form.at });
}

async function copy(session: Session, form: Form): Promise<void> {
  if (session.action.kind !== "copy") return;
  const block = copyText([
    {
      file: session.action.file,
      machine: session.machine.id,
      target: form.target,
      note: form.field.value,
    },
  ]);
  const clipboard = session.doc.defaultView?.navigator.clipboard;
  const written = await (
    clipboard === undefined ? Promise.reject(new Error("no clipboard")) : clipboard.writeText(block)
  ).then(
    () => true,
    () => false,
  );
  if (written) {
    closeBox(session);
    showToast(session, { text: "Note copied", at: form.at });
    return;
  }
  form.field.value = block;
  form.field.select();
  form.button.hidden = true;
  form.status.textContent = "Could not copy. Copy the selected text.";
}

function primaryButton(session: Session): HTMLButtonElement {
  const button = session.doc.createElement("button");
  button.type = "button";
  button.className = "primary";
  const saving = session.action.kind === "save";
  button.dataset[saving ? "noteSave" : "noteCopy"] = "";
  button.textContent = saving ? "Save note" : "Copy for agent";
  button.disabled = true;
  return button;
}

/** The textarea, status line and primary button; they are wired to save or copy. */
function addForm(
  session: Session,
  options: { element: HTMLElement; target: NoteTarget; at: Point; status: HTMLElement },
): void {
  const { element, target, at, status } = options;
  const { doc, action } = session;
  if (action.kind === "save" && session.phase.kind === "showing") {
    const list = noteList(doc, target, session.phase.notes);
    if (list !== undefined) element.append(list);
  }
  const field = doc.createElement("textarea");
  field.setAttribute("aria-label", "Note");
  field.rows = 3;
  field.maxLength = MAX_NOTE_LENGTH;
  field.style.cssText = "width:100%;box-sizing:border-box";
  const button = primaryButton(session);
  const idle = button.textContent;
  const form: Form = { target, at, field, status, button };
  let busy = false;
  const sync = () => {
    button.disabled = busy || field.value.trim() === "";
  };
  field.addEventListener("input", sync);
  button.addEventListener("click", () => {
    if (button.disabled) return;
    if (action.kind === "copy") {
      void copy(session, form);
      return;
    }
    busy = true;
    button.textContent = "Saving...";
    sync();
    void save(session, form).then(() => {
      busy = false;
      button.textContent = idle;
      sync();
    });
  });
  element.append(field, status, button);
}

function openBox(session: Session, options: { target: NoteTarget; at: Point }): void {
  const { target, at } = options;
  const { doc, viewer } = session;
  const element = doc.createElement("div");
  element.className = "note-composer";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", `Note on ${targetLabel(target)}`);
  element.dataset["noteComposer"] = targetText(target);
  element.style.cssText = `position:fixed;width:min(22rem, calc(100vw - 16px));padding:8px;${LOOK}`;
  const heading = doc.createElement("h3");
  heading.textContent = targetLabel(target);
  element.append(heading);
  const status = doc.createElement("p");
  status.className = "notes-status";
  status.setAttribute("role", "status");
  if (session.phase.kind === "refused") {
    status.textContent = session.phase.message;
    element.append(status);
  } else {
    addForm(session, { element, target, at, status });
  }
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.dataset["noteCancel"] = "";
  cancel.addEventListener("click", () => closeBox(session));
  element.append(cancel);
  viewer.append(element);
  session.box = element;
  place(session, { element, at });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBox(session);
  });
  const outside = (event: Event) => {
    if (!(event.target instanceof Node) || !element.contains(event.target)) closeBox(session);
  };
  doc.addEventListener("pointerdown", outside);
  session.stopOutside = () => doc.removeEventListener("pointerdown", outside);
  element.querySelector("textarea")?.focus({ preventScroll: true });
}

/** The state or arrow a right-click landed on, when it can carry a note. */
function targetAt(session: Session, event: MouseEvent): NoteTarget | undefined {
  const origin = event.target instanceof Element ? event.target : undefined;
  const group = origin?.closest("g[data-edge-id], g[data-node-id]");
  if (group === null || group === undefined) return undefined;
  const edge = group.getAttribute("data-edge-id");
  const selection =
    edge === null
      ? ({ kind: "state", id: group.getAttribute("data-node-id") ?? "" } as const)
      : ({ kind: "edge", id: edge } as const);
  return targetOf(selection, session.machine);
}

/** Right-click (or the context-menu key) on a state or arrow of `viewer` opens a note box; other right-clicks keep the browser menu. */
export function listenForNotes(
  viewer: HTMLElement,
  context: { machine: VizMachine; action: NoteAction },
): void {
  const { machine, action } = context;
  const session: Session = {
    viewer,
    doc: viewer.ownerDocument,
    machine,
    action,
    phase: action.kind === "save" ? { kind: "loading" } : { kind: "unavailable" },
    box: undefined,
    toast: undefined,
    toastTimer: undefined,
    stopOutside: undefined,
  };
  if (action.kind === "save") {
    void fetchPhase(action.url, machine.id).then((next) => {
      session.phase = next;
    });
  }
  viewer.addEventListener("contextmenu", (event) => {
    const waiting = session.phase.kind === "loading" || session.phase.kind === "unavailable";
    if (action.kind === "save" && waiting) return;
    const target = targetAt(session, event);
    if (target === undefined) return;
    event.preventDefault();
    clearToast(session);
    closeBox(session);
    openBox(session, { target, at: { x: event.clientX, y: event.clientY } });
  });
}
