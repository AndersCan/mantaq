// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");
const create = () => {
  const clock = VirtualClock();
  return { actor: createCheckoutActor(clock), clock };
};
const original = globalThis.fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let page = 0;

async function documentText(): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createCheckoutActor }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

/** Each test gets its own pathname, so the page's in-memory notes start empty. */
async function draw(options: { notes?: string } = {}): Promise<HTMLElement> {
  page += 1;
  history.replaceState(null, "", `/copy-${page}/?machine=checkout`);
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: await documentText(),
    targets: { checkout: create },
    copyNotes: { file: "src/checkout.ts" },
    ...options,
  });
  await tick();
  return root;
}

const click = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-node-id='${id}']`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function addNote(root: HTMLElement, text: string): void {
  const field = root.querySelector<HTMLTextAreaElement>("section.notes textarea")!;
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  root
    .querySelector("section.notes form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
}

const bar = (root: HTMLElement) => root.querySelector<HTMLElement>("section.notes-send");
const barLine = (root: HTMLElement) => bar(root)?.querySelector("p")?.textContent;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
  document.body.replaceChildren();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("notes on a page without a dev server", () => {
  test("shows a hint first, then a note box for a selected state, and never fetches", async () => {
    const root = await draw();
    expect(root.querySelector("section.notes")?.textContent).toBe(
      "Tap a state or arrow to leave a note for your agent.",
    );
    expect(bar(root)?.hidden).toBe(true);
    click(root, "payment");
    expect(root.querySelector("section.notes h3")?.textContent).toBe("Notes on payment");
    expect(root.querySelector("section.notes button")?.textContent).toBe("Add note");
    expect(root.querySelector<HTMLButtonElement>("section.notes button")?.disabled).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("selecting a state or edge does not scroll the page", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const root = await draw();
    click(root, "payment");
    addNote(root, "x");
    click(root, "payment");
    expect(scroll).not.toHaveBeenCalled();
  });

  test("adding a note lists it as To send and shows the bar", async () => {
    const root = await draw();
    click(root, "payment");
    addNote(root, "needs a cancel");
    const item = root.querySelector("section.notes li");
    expect(item?.getAttribute("data-status")).toBe("unsent");
    expect(item?.textContent).toBe("To send needs a cancel");
    expect(root.querySelector("section.notes p[role=status]")?.textContent).toBe(
      "Note added. Copy it for your agent below.",
    );
    expect(bar(root)?.hidden).toBe(false);
    expect(barLine(root)).toBe("1 note to send from this page.");
  });

  test("a rejected clipboard shows one line and keeps the notes", async () => {
    const root = await draw();
    click(root, "payment");
    addNote(root, "x");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    bar(root)!.querySelector<HTMLButtonElement>("[data-copy-notes]")!.click();
    await tick();
    expect(barLine(root)).toBe("Could not copy. Select the notes and copy them yourself.");
    expect(bar(root)?.hidden).toBe(false);
  });

  test("no clipboard at all shows the same line", async () => {
    const root = await draw();
    click(root, "payment");
    addNote(root, "x");
    bar(root)!.querySelector<HTMLButtonElement>("[data-copy-notes]")!.click();
    await tick();
    expect(barLine(root)).toBe("Could not copy. Select the notes and copy them yourself.");
  });

  test("two embeds on one page share the notes", async () => {
    const first = await draw();
    const second = document.createElement("div");
    document.body.append(second);
    mountDriven(second, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
      copyNotes: { file: "src/checkout.ts" },
    });
    await tick();
    click(first, "payment");
    addNote(first, "from the first");
    expect(barLine(second)).toBe("1 note to send from this page.");
    expect(bar(second)?.hidden).toBe(false);
  });

  test("the dev-server notes url wins over copyNotes", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: 1, file: "x.notes.md", exists: false, notes: [] })),
    ) as typeof fetch;
    const root = await draw({ notes: "/__mantaq/notes" });
    click(root, "payment");
    await tick();
    expect(root.querySelector("section.notes button")?.textContent).toBe("Save note");
    expect(bar(root)).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
