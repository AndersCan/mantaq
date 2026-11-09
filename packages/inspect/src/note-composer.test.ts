// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createCreditActor } from "./fixtures/credit.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const url = "/__mantaq/notes";

const note = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  machine: "checkout",
  on: "state payment",
  target: { kind: "state", state: "payment" },
  status: "open",
  note: `note ${id}`,
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const empty = async () => json(200, { version: 1, file: "x.notes.md", exists: false, notes: [] });

async function documentText(name: string, load: Record<string, unknown>): Promise<string> {
  const inspected = await inspectModule(join(import.meta.dirname, "fixtures", name), {
    load: async () => load as never,
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

const checkout = () => {
  const clock = VirtualClock();
  return { actor: createCheckoutActor(clock), clock };
};

async function mount(options: {
  notes?: string;
  copyNotes?: { file: string };
}): Promise<HTMLElement> {
  history.replaceState(null, "", "?");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: await documentText("checkout.ts", { createCheckoutActor }),
    targets: { checkout: checkout } as never,
    ...options,
  });
  await flush();
  return root;
}

async function mountCredit(): Promise<HTMLElement> {
  history.replaceState(null, "", "?machine=credit");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: await documentText("credit.ts", { createCreditActor }),
    targets: {
      credit: () => {
        const clock = VirtualClock();
        return { actor: createCreditActor(clock), clock };
      },
    } as never,
    notes: url,
  });
  await flush();
  return root;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function rightClick(root: HTMLElement, selector: string): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100,
  });
  root.querySelector(selector)?.dispatchEvent(event);
  return event;
}

const state = (id: string) => `g[data-node-id="${id}"]`;
const edge = (id: string) => `g[data-edge-id="${id}"]`;
const composer = (root: HTMLElement) => root.querySelector<HTMLElement>(".note-composer");
const field = (root: HTMLElement) => {
  const found = root.querySelector<HTMLTextAreaElement>(".note-composer textarea");
  if (found === null) throw new Error("no textarea");
  return found;
};
const status = (root: HTMLElement) => root.querySelector(".note-composer .notes-status");
const toast = (root: HTMLElement) => root.querySelector("[data-note-toast]");

function type(root: HTMLElement, text: string): void {
  field(root).value = text;
  field(root).dispatchEvent(new Event("input", { bubbles: true }));
}

const press = (root: HTMLElement, selector: string) =>
  root.querySelector<HTMLElement>(selector)?.click();

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
let respond: (url: string, init: RequestInit | undefined) => Promise<Response>;

beforeEach(() => {
  calls = [];
  respond = async () => json(404, {});
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    return respond(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("right-click opens a note box", () => {
  test("a left click on a state shows no notes UI", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    root.querySelector(state("payment"))?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(composer(root)).toBeNull();
    expect(root.querySelector("section.notes")).toBeNull();
    const panel = root.querySelector("aside.panel")?.textContent ?? "";
    expect(panel).not.toMatch(/add a note|save note|copy for agent|notes on/i);
  });

  test("right-click on a state opens the box at the pointer and prevents the browser menu", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    const event = rightClick(root, state("payment"));
    expect(event.defaultPrevented).toBe(true);
    const box = composer(root);
    expect(box?.querySelector("h3")?.textContent).toBe("payment");
    expect(box?.getAttribute("role")).toBe("dialog");
    expect(box?.getAttribute("aria-label")).toBe("Note on payment");
    expect(box?.dataset["noteComposer"]).toBe("state payment");
    expect(box?.style.left).toBe("100px");
    expect(box?.style.top).toBe("100px");
    expect(document.activeElement).toBe(field(root));
  });

  test("the box stays inside the window", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 5,
    });
    root.querySelector(state("payment"))?.dispatchEvent(event);
    expect(composer(root)?.style.left).toBe("8px");
    expect(composer(root)?.style.top).toBe("8px");
  });

  test("right-click on the start arrow, an effect loop or empty canvas keeps the browser menu", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    for (const selector of [
      edge("__initial__->basicInfo"),
      edge("submitting-effect:submitting-submitting"),
      "svg",
    ]) {
      expect(rightClick(root, selector).defaultPrevented).toBe(false);
    }
    expect(composer(root)).toBeNull();
  });

  test("a second right-click replaces the box", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    rightClick(root, edge("payment-back-shippingAddress"));
    expect(root.querySelectorAll(".note-composer")).toHaveLength(1);
    expect(composer(root)?.querySelector("h3")?.textContent).toBe("back from payment");
  });
});

describe("copy mode", () => {
  const block =
    "mantaq notes v1 for src/checkout.ts\n- id: p1\n  machine: checkout\n  on: state payment\n  status: open\n  note: needs a cancel\n";
  let written: string[];
  const clipboard = (write: (text: string) => Promise<void>) => {
    written = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return write(text);
        },
      },
    });
  };

  test("Copy for agent copies one block and shows Note copied", async () => {
    clipboard(async () => {});
    const root = await mount({ copyNotes: { file: "src/checkout.ts" } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rightClick(root, state("payment"));
    const button = root.querySelector<HTMLButtonElement>("[data-note-copy]");
    expect(button?.textContent).toBe("Copy for agent");
    expect(button?.disabled).toBe(true);
    type(root, "needs a cancel");
    expect(button?.disabled).toBe(false);
    type(root, "   ");
    expect(button?.disabled).toBe(true);
    type(root, "needs a cancel");
    button?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([block]);
    expect(composer(root)).toBeNull();
    expect(toast(root)?.textContent).toBe("Note copied");
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(toast(root)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(toast(root)).toBeNull();
  });

  test("the next right-click removes the toast", async () => {
    clipboard(async () => {});
    const root = await mount({ copyNotes: { file: "src/checkout.ts" } });
    rightClick(root, state("payment"));
    type(root, "x");
    press(root, "[data-note-copy]");
    await flush();
    expect(toast(root)).not.toBeNull();
    rightClick(root, state("payment"));
    expect(toast(root)).toBeNull();
  });

  test("a refused clipboard selects the block in the box", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    const root = await mount({ copyNotes: { file: "src/checkout.ts" } });
    rightClick(root, state("payment"));
    type(root, "needs a cancel");
    press(root, "[data-note-copy]");
    await flush();
    expect(field(root).value).toBe(block);
    expect([field(root).selectionStart, field(root).selectionEnd]).toEqual([0, block.length]);
    expect(root.querySelector<HTMLElement>("[data-note-copy]")?.hidden).toBe(true);
    expect(status(root)?.textContent).toBe("Could not copy. Copy the selected text.");
    expect(toast(root)).toBeNull();
  });

  test("no clipboard behaves like a refused one", async () => {
    vi.stubGlobal("navigator", {});
    const root = await mount({ copyNotes: { file: "src/checkout.ts" } });
    rightClick(root, state("payment"));
    type(root, "needs a cancel");
    press(root, "[data-note-copy]");
    await flush();
    expect(field(root).value).toBe(block);
  });

  test("Escape, Cancel and a click outside close it and drop the draft", async () => {
    const root = await mount({ copyNotes: { file: "src/checkout.ts" } });
    rightClick(root, state("payment"));
    type(root, "draft");
    field(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(composer(root)).toBeNull();
    rightClick(root, state("payment"));
    expect(field(root).value).toBe("");
    press(root, "[data-note-cancel]");
    expect(composer(root)).toBeNull();
    rightClick(root, state("payment"));
    field(root).dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(composer(root)).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(composer(root)).toBeNull();
  });

  test("the dev-server notes url wins over copyNotes", async () => {
    respond = empty;
    const root = await mount({ notes: url, copyNotes: { file: "src/checkout.ts" } });
    rightClick(root, state("payment"));
    expect(root.querySelector("[data-note-save]")).not.toBeNull();
    expect(root.querySelector("[data-note-copy]")).toBeNull();
  });
});

describe("save mode", () => {
  test("a 404 or a network error intercepts nothing", async () => {
    const root = await mount({ notes: url });
    expect(rightClick(root, state("payment")).defaultPrevented).toBe(false);
    expect(composer(root)).toBeNull();
    expect(calls[0]?.url).toBe(`${url}?machine=checkout`);
    document.body.replaceChildren();
    respond = async () => {
      throw new TypeError("offline");
    };
    const again = await mount({ notes: url });
    expect(rightClick(again, state("payment")).defaultPrevented).toBe(false);
  });

  test("nothing is intercepted before the endpoint answers", async () => {
    respond = () => new Promise(() => {});
    const root = await mount({ notes: url });
    expect(rightClick(root, state("payment")).defaultPrevented).toBe(false);
  });

  test("a state lists its open and done notes with Result and Question", async () => {
    respond = async () =>
      json(200, {
        version: 1,
        file: "src/checkout.notes.md",
        exists: true,
        notes: [
          note("n1"),
          note("n2", { status: "done", result: "added cancel" }),
          note("n3", { question: "which one?" }),
          note("n4", { on: "state other", target: { kind: "state", state: "other" } }),
        ],
      });
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    const items = [...root.querySelectorAll<HTMLElement>(".note-composer li[data-note-id]")];
    expect(items.map((each) => [each.dataset["noteId"], each.dataset["status"]])).toEqual([
      ["n1", "open"],
      ["n2", "done"],
      ["n3", "open"],
    ]);
    expect(items[1]?.querySelector("strong")?.textContent).toBe("Done");
    expect(items[1]?.textContent).toContain("Result: added cancel");
    expect(items[2]?.textContent).toContain("Question: which one?");
  });

  test("a state with no notes shows no list and no empty line", async () => {
    respond = empty;
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    expect(composer(root)?.querySelector("ul, .hint")).toBeNull();
  });

  test("Save posts the target, closes, and toasts the file; the next box lists it", async () => {
    respond = async (_url, init) =>
      init?.method === "POST"
        ? json(200, {
            version: 1,
            file: "src/checkout.notes.md",
            note: note("n1", { note: "needs a cancel" }),
          })
        : empty();
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    const button = root.querySelector<HTMLButtonElement>("[data-note-save]");
    expect(button?.textContent).toBe("Save note");
    expect(button?.disabled).toBe(true);
    type(root, "needs a cancel");
    button?.click();
    expect(button?.textContent).toBe("Saving...");
    expect(button?.disabled).toBe(true);
    await flush();
    const posted = calls.find((each) => each.init?.method === "POST");
    expect(posted?.url).toBe(url);
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      version: 1,
      machine: "checkout",
      target: { kind: "state", state: "payment" },
      note: "needs a cancel",
    });
    expect(composer(root)).toBeNull();
    expect(toast(root)?.textContent).toBe("Saved in src/checkout.notes.md");
    rightClick(root, state("payment"));
    expect(composer(root)?.querySelector("li[data-note-id=n1]")?.textContent).toContain(
      "needs a cancel",
    );
    expect(toast(root)).toBeNull();
  });

  test("a failed save keeps the box and the text and shows each reason", async () => {
    let failure: () => Promise<Response> = async () =>
      json(500, { error: "could not write x (EACCES)" });
    respond = async (_url, init) => (init?.method === "POST" ? failure() : empty());
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    type(root, "keep me");
    press(root, "[data-note-save]");
    await flush();
    expect(status(root)?.textContent).toBe(
      "Could not save this note: could not write x (EACCES). Your text is still here.",
    );
    expect(field(root).value).toBe("keep me");
    expect(root.querySelector<HTMLButtonElement>("[data-note-save]")?.disabled).toBe(false);
    expect(root.querySelector("[data-note-save]")?.textContent).toBe("Save note");
    failure = async () => {
      throw new TypeError("offline");
    };
    press(root, "[data-note-save]");
    await flush();
    expect(status(root)?.textContent).toBe(
      "Could not save this note: the dev server did not answer. Your text is still here.",
    );
    expect(field(root).value).toBe("keep me");
  });

  test("a slow save does not close the box opened after it", async () => {
    let finish: (response: Response) => void = () => {};
    respond = (_url, init) =>
      init?.method === "POST" ? new Promise<Response>((resolve) => (finish = resolve)) : empty();
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    type(root, "first draft");
    press(root, "[data-note-save]");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(composer(root)).toBeNull();
    rightClick(root, state("shippingAddress"));
    type(root, "second draft");
    finish(json(200, { version: 1, file: "x.notes.md", note: note("n9") }));
    await flush();
    expect(composer(root)?.dataset["noteComposer"]).toBe("state shippingAddress");
    expect(field(root).value).toBe("second draft");
  });

  test("a save that fails after the box closed says so", async () => {
    let finish: (response: Response) => void = () => {};
    respond = (_url, init) =>
      init?.method === "POST" ? new Promise<Response>((resolve) => (finish = resolve)) : empty();
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    type(root, "lost");
    press(root, "[data-note-save]");
    field(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    finish(json(500, { error: "disk full" }));
    await flush();
    expect(composer(root)).toBeNull();
    expect(toast(root)?.textContent).toContain("disk full");
  });

  test("a 409 shows the message only", async () => {
    respond = async () =>
      json(409, { error: "x.notes.md is mantaq notes v2; update @mantaq/inspect" });
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    expect(composer(root)?.querySelector("textarea")).toBeNull();
    expect(status(root)?.textContent).toBe("x.notes.md is mantaq notes v2; update @mantaq/inspect");
    expect(composer(root)?.querySelector("[data-note-cancel]")).not.toBeNull();
    expect(composer(root)?.querySelector("button.primary")).toBeNull();
  });

  test("another version asks for a reload", async () => {
    respond = async () => json(200, { version: 2, notes: [] });
    const root = await mount({ notes: url });
    rightClick(root, state("payment"));
    expect(status(root)?.textContent).toBe("Notes need a page reload.");
  });

  test("an arrow lists its own notes and saves the arrow target", async () => {
    const edgeNote = (id: string) =>
      note(id, {
        on: "edge payment back",
        target: { kind: "edge", from: "payment", event: "back" },
      });
    respond = async (_url, init) =>
      init?.method === "POST"
        ? json(200, { version: 1, file: "x", note: edgeNote("n3") })
        : json(200, { version: 1, file: "x", exists: true, notes: [edgeNote("n1"), note("n2")] });
    const root = await mount({ notes: url });
    rightClick(root, edge("payment-back-shippingAddress"));
    expect(composer(root)?.querySelector("h3")?.textContent).toBe("back from payment");
    expect(
      [...root.querySelectorAll<HTMLElement>(".note-composer li")].map(
        (each) => each.dataset["noteId"],
      ),
    ).toEqual(["n1"]);
    type(root, "go back twice");
    press(root, "[data-note-save]");
    await flush();
    const posted = calls.find((each) => each.init?.method === "POST");
    expect(JSON.parse(String(posted?.init?.body))["target"]).toEqual({
      kind: "edge",
      from: "payment",
      event: "back",
    });
  });

  test("a stay arrow can be noted", async () => {
    respond = empty;
    const root = await mountCredit();
    rightClick(root, edge("idle-setTier-stay"));
    expect(composer(root)?.querySelector("h3")?.textContent).toBe("setTier from idle");
  });
});
