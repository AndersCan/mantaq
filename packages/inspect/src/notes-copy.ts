/**
 * The notes box on a page that has no dev server (a pull request preview, the published
 * site): notes and journeys stay in the tab and are copied as one block for the user
 * to paste to their coding agent.
 */
import type { VizMachine } from "@mantaq/viz";
import type { ViewerSelection } from "@mantaq/viz/viewer";
import { MAX_NOTE_LENGTH, copyText } from "./notes.ts";
import type { CopiedNote, NoteTarget } from "./notes.ts";
import { key, targetLabel, targetOf } from "./notes-page.ts";

const CHANGE = "mantaq-notes-change";

export interface PageNotes {
  list(): CopiedNote[];
  add(note: CopiedNote): void;
}

/** Every embed on one page shares one list, kept in memory until the page reloads. */
const pages = new Map<string, CopiedNote[]>();

export function pageNotes(doc: Document): PageNotes {
  const where = doc.defaultView?.location.pathname ?? "";
  return {
    list: () => [...(pages.get(where) ?? [])],
    add: (note) => {
      pages.set(where, [...(pages.get(where) ?? []), note]);
      doc.dispatchEvent(new Event(CHANGE));
    },
  };
}

function count(n: number): string {
  return `${n} ${n === 1 ? "note" : "notes"}`;
}

function paragraph(doc: Document, className: string, text: string): HTMLParagraphElement {
  const element = doc.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

/** The notes section for the selected state or arrow; same contract as `notesFooter`. */
export function copyNotesFooter(
  doc: Document,
  context: { file: string; machine: VizMachine; store: PageNotes },
): (selection: ViewerSelection | undefined) => Node | undefined {
  const section = doc.createElement("section");
  section.className = "notes";
  let target: NoteTarget | undefined;
  let status = "";
  let draft = "";

  const render = () => {
    section.replaceChildren();
    const mine =
      target === undefined
        ? []
        : context.store
            .list()
            .filter(
              (each) => each.machine === context.machine.id && key(each.target) === key(target),
            );
    if (target === undefined) {
      section.hidden = context.store.list().length > 0;
      section.append(
        paragraph(doc, "hint", "Tap a state or arrow to leave a note for your agent."),
      );
      return;
    }
    section.hidden = false;
    const label = targetLabel(target);
    const heading = doc.createElement("h3");
    heading.textContent = `Notes on ${label}`;
    section.append(
      heading,
      paragraph(
        doc,
        "hint",
        "This page cannot save notes. Add them here, then copy them for your agent.",
      ),
    );
    if (mine.length === 0) {
      section.append(paragraph(doc, "hint", `No notes on ${label} yet.`));
    } else {
      const list = doc.createElement("ul");
      list.className = "notes-list";
      for (const each of mine) {
        const item = doc.createElement("li");
        item.dataset["status"] = "unsent";
        const flag = doc.createElement("strong");
        flag.textContent = "To send";
        item.append(flag, ` ${each.note}`);
        list.append(item);
      }
      section.append(list);
    }
    const line = paragraph(doc, "notes-status", status);
    line.setAttribute("role", "status");
    section.append(form(target), line);
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
    label.append(field);
    const button = doc.createElement("button");
    button.type = "submit";
    button.textContent = "Add note";
    button.disabled = draft.trim() === "";
    field.addEventListener("input", () => {
      draft = field.value;
      button.disabled = draft.trim() === "";
    });
    element.addEventListener("submit", (event) => {
      event.preventDefault();
      if (draft.trim() === "") return;
      const note = draft;
      draft = "";
      status = "Note added. Copy it for your agent below.";
      context.store.add({
        file: context.file,
        machine: context.machine.id,
        target: forTarget,
        note,
      });
      render();
    });
    element.append(label, button);
    return element;
  };

  doc.addEventListener(CHANGE, () => {
    if (target === undefined) render();
  });
  render();

  return (selection) => {
    const next = targetOf(selection, context.machine);
    if (key(next) !== key(target)) {
      target = next;
      draft = "";
      status = "";
      render();
      if (next !== undefined) section.scrollIntoView?.({ block: "nearest" });
    }
    return section;
  };
}

/** The bar that counts this page's notes and copies them; hidden while there are none. */
export function sendBar(doc: Document, store: PageNotes): HTMLElement {
  const bar = doc.createElement("section");
  bar.className = "notes-send";
  const line = doc.createElement("p");
  line.setAttribute("role", "status");
  const copy = doc.createElement("button");
  copy.type = "button";
  copy.dataset["copyNotes"] = "";
  copy.textContent = "Copy for your agent";
  bar.append(line, copy);

  const show = (text?: string) => {
    const n = store.list().length;
    bar.hidden = n === 0;
    line.textContent = text ?? `${count(n)} to send from this page.`;
  };
  copy.addEventListener("click", () => {
    const all = store.list();
    const clipboard = doc.defaultView?.navigator.clipboard;
    const written =
      clipboard === undefined
        ? Promise.reject(new Error("no clipboard"))
        : clipboard.writeText(copyText(all));
    written.then(
      () => show(`${count(all.length)} copied`),
      () => show("Could not copy. Select the notes and copy them yourself."),
    );
  });
  doc.addEventListener(CHANGE, () => show());
  show();
  return bar;
}
