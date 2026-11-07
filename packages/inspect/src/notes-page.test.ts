// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");
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

async function documentText(): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createCheckoutActor }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

const create = () => {
  const clock = VirtualClock();
  return { actor: createCheckoutActor(clock), clock };
};

async function mount(): Promise<HTMLElement> {
  history.replaceState(null, "", "?");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: await documentText(),
    targets: { checkout: create },
    notes: url,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

const section = (root: HTMLElement) => root.querySelector<HTMLElement>("section.notes");
const click = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-node-id='${id}']`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  document.body.replaceChildren();
});

describe("notes section", () => {
  test("an endpoint that answers 404 leaves the section hidden and the viewer working", async () => {
    const root = await mount();
    click(root, "payment");
    expect(section(root)?.hidden).toBe(true);
    expect(root.querySelector("aside.panel")).not.toBeNull();
    expect(calls[0]?.url).toBe(`${url}?machine=checkout`);
  });

  test("a network error also leaves it hidden", async () => {
    respond = async () => {
      throw new TypeError("offline");
    };
    const root = await mount();
    click(root, "payment");
    expect(section(root)?.hidden).toBe(true);
  });

  test("nothing selected shows no notes", async () => {
    respond = async () => json(200, { version: 1, file: "a.notes.md", exists: false, notes: [] });
    const root = await mount();
    expect(section(root)?.hidden).toBe(true);
  });

  test("a clicked state lists its notes, open and done, with the result", async () => {
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
    const root = await mount();
    click(root, "payment");
    const node = section(root);
    expect(node?.hidden).toBe(false);
    expect(node?.querySelector("h3")?.textContent).toBe("Notes on payment");
    const items = [...(node?.querySelectorAll<HTMLElement>("li[data-note-id]") ?? [])];
    expect(items.map((each) => [each.dataset["noteId"], each.dataset["status"]])).toEqual([
      ["n1", "open"],
      ["n2", "done"],
      ["n3", "open"],
    ]);
    expect(items[1]?.querySelector("strong")?.textContent).toBe("Done");
    expect(items[1]?.textContent).toContain("Result: added cancel");
    expect(items[2]?.textContent).toContain("Question: which one?");
    expect(node?.querySelector(".notes-file")?.textContent).toBe("Saved in src/checkout.notes.md");
  });

  test("a state with no notes says so and offers the form", async () => {
    respond = async () => json(200, { version: 1, file: "x", exists: false, notes: [] });
    const root = await mount();
    click(root, "payment");
    expect(section(root)?.querySelector(".hint")?.textContent).toBe("No notes on payment yet.");
    expect(section(root)?.querySelector(".notes-file")).toBeNull();
    expect(section(root)?.querySelector("label")?.textContent).toBe("Add a note");
  });

  test("saving posts the note, lists it, clears the field and shows the file", async () => {
    respond = async (_url, init) =>
      init?.method === "POST"
        ? json(200, {
            version: 1,
            file: "src/checkout.notes.md",
            note: note("n1", { note: "needs a cancel" }),
          })
        : json(200, { version: 1, file: "src/checkout.notes.md", exists: false, notes: [] });
    const root = await mount();
    click(root, "payment");
    const field = section(root)?.querySelector("textarea");
    const button = section(root)?.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(button?.disabled).toBe(true);
    if (field === null || field === undefined) throw new Error("no field");
    field.value = "needs a cancel";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(button?.disabled).toBe(false);
    section(root)
      ?.querySelector("form")
      ?.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    const post = calls.find((each) => each.init?.method === "POST");
    expect(post?.url).toBe(url);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      version: 1,
      machine: "checkout",
      target: { kind: "state", state: "payment" },
      note: "needs a cancel",
    });
    const node = section(root);
    expect(node?.querySelector(".notes-status")?.textContent).toBe("Note saved");
    expect(node?.querySelector("li[data-note-id=n1]")?.textContent).toContain("needs a cancel");
    expect(node?.querySelector("textarea")?.value).toBe("");
    expect(node?.querySelector(".notes-file")?.textContent).toBe("Saved in src/checkout.notes.md");
  });

  test("a failed save keeps the text and shows each reason", async () => {
    let failure: () => Promise<Response> = async () =>
      json(500, { error: "could not write x (EACCES)" });
    respond = async (_url, init) =>
      init?.method === "POST"
        ? failure()
        : json(200, { version: 1, file: "x", exists: false, notes: [] });
    const root = await mount();
    click(root, "payment");
    const submit = async (text: string) => {
      const field = section(root)?.querySelector("textarea");
      if (field === null || field === undefined) throw new Error("no field");
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      section(root)
        ?.querySelector("form")
        ?.dispatchEvent(new Event("submit", { cancelable: true }));
      await flush();
    };
    await submit("keep me");
    expect(section(root)?.querySelector(".notes-status")?.textContent).toBe(
      "Could not save this note: could not write x (EACCES). Your text is still here.",
    );
    expect(section(root)?.querySelector("textarea")?.value).toBe("keep me");
    failure = async () => {
      throw new TypeError("offline");
    };
    await submit("keep me");
    expect(section(root)?.querySelector(".notes-status")?.textContent).toBe(
      "Could not save this note: the dev server did not answer. Your text is still here.",
    );
    expect(section(root)?.querySelector("textarea")?.value).toBe("keep me");
  });

  test("a 409 shows the server's message and no form", async () => {
    respond = async () =>
      json(409, { error: "x.notes.md is mantaq notes v2; update @mantaq/inspect" });
    const root = await mount();
    click(root, "payment");
    expect(section(root)?.textContent).toBe(
      "x.notes.md is mantaq notes v2; update @mantaq/inspect",
    );
    expect(section(root)?.querySelector("form")).toBeNull();
  });

  test("another version asks for a reload", async () => {
    respond = async () => json(200, { version: 2, notes: [] });
    const root = await mount();
    click(root, "payment");
    expect(section(root)?.textContent).toBe("Notes need a page reload.");
  });

  test("typing survives a panel refresh on the same state", async () => {
    respond = async () => json(200, { version: 1, file: "x", exists: false, notes: [] });
    const root = await mount();
    click(root, "payment");
    const field = section(root)?.querySelector("textarea");
    if (field === null || field === undefined) throw new Error("no field");
    field.value = "half a thought";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    click(root, "payment");
    expect(section(root)?.querySelector("textarea")?.value).toBe("half a thought");
  });

  test("without a notes url nothing is fetched and no section shows", async () => {
    history.replaceState(null, "", "?");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await documentText(), targets: {} });
    expect(root.querySelector("section.notes")).toBeNull();
    expect(calls).toEqual([]);
  });
});
