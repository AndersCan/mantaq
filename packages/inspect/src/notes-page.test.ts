// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { createCreditActor } from "./fixtures/credit.ts";
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
  return mountText(await documentText(), { checkout: create }, "?");
}

async function mountCredit(): Promise<HTMLElement> {
  const inspected = await inspectModule(join(import.meta.dirname, "fixtures", "credit.ts"), {
    load: async () => ({ createCreditActor }),
    fuzz: false,
  });
  const text = serializeViz(vizDocument(inspected.machines));
  return mountText(
    text,
    {
      credit: () => {
        const clock = VirtualClock();
        return { actor: createCreditActor(clock), clock };
      },
    },
    "?machine=credit",
  );
}

async function mountText(
  text: string,
  targets: Record<string, () => unknown>,
  query: string,
): Promise<HTMLElement> {
  history.replaceState(null, "", query);
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, { source: "test", text, targets: targets as never, notes: url });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

const section = (root: HTMLElement) => root.querySelector<HTMLElement>("section.notes");
const click = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-node-id='${id}']`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id='${id}']`)
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

  describe("arrows", () => {
    const empty = async () => json(200, { version: 1, file: "x", exists: false, notes: [] });
    const edgeNote = (id: string, over: Record<string, unknown> = {}) =>
      note(id, {
        on: "edge payment back",
        target: { kind: "edge", from: "payment", event: "back" },
        ...over,
      });
    const type = (root: HTMLElement, text: string) => {
      const field = section(root)?.querySelector("textarea");
      if (field === null || field === undefined) throw new Error("no field");
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const submit = async (root: HTMLElement) => {
      section(root)
        ?.querySelector("form")
        ?.dispatchEvent(new Event("submit", { cancelable: true }));
      await flush();
    };

    test("a clicked arrow lists its own notes, not the state's", async () => {
      respond = async () =>
        json(200, { version: 1, file: "x", exists: true, notes: [edgeNote("n1"), note("n2")] });
      const root = await mount();
      clickEdge(root, "payment-back-shippingAddress");
      const node = section(root);
      expect(node?.querySelector("h3")?.textContent).toBe("Notes on back from payment");
      expect(
        [...(node?.querySelectorAll<HTMLElement>("li[data-note-id]") ?? [])].map(
          (each) => each.dataset["noteId"],
        ),
      ).toEqual(["n1"]);
      expect(node?.textContent).not.toContain("share these notes");
    });

    test("saving posts the arrow target", async () => {
      respond = async (_url, init) =>
        init?.method === "POST"
          ? json(200, { version: 1, file: "x", note: edgeNote("n1", { note: "go back twice" }) })
          : empty();
      const root = await mount();
      clickEdge(root, "payment-back-shippingAddress");
      type(root, "go back twice");
      await submit(root);
      const post = calls.find((each) => each.init?.method === "POST");
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        version: 1,
        machine: "checkout",
        target: { kind: "edge", from: "payment", event: "back" },
        note: "go back twice",
      });
      expect(section(root)?.querySelector(".notes-status")?.textContent).toBe("Note saved");
      expect(section(root)?.querySelector("li[data-note-id=n1]")).not.toBeNull();
    });

    test("a refused arrow shows the reason and keeps the text", async () => {
      respond = async (_url, init) =>
        init?.method === "POST"
          ? json(404, { error: "no arrow back from payment in checkout" })
          : empty();
      const root = await mount();
      clickEdge(root, "payment-back-shippingAddress");
      type(root, "keep me");
      await submit(root);
      expect(section(root)?.querySelector(".notes-status")?.textContent).toBe(
        "Could not save this note: no arrow back from payment in checkout. Your text is still here.",
      );
      expect(section(root)?.querySelector("textarea")?.value).toBe("keep me");
    });

    test("an arrow with no notes says so", async () => {
      respond = empty;
      const root = await mount();
      clickEdge(root, "payment-back-shippingAddress");
      expect(section(root)?.querySelector(".hint")?.textContent).toBe(
        "No notes on back from payment yet.",
      );
    });

    test("effect loops and the start arrow get no section", async () => {
      respond = empty;
      const root = await mount();
      clickEdge(root, "submitting-effect:submitting-submitting");
      expect(section(root)?.hidden).toBe(true);
      clickEdge(root, "__initial__->basicInfo");
      expect(section(root)?.hidden).toBe(true);
    });

    test("switching from a state to an arrow clears the draft", async () => {
      respond = async () =>
        json(200, { version: 1, file: "x", exists: true, notes: [note("n2"), edgeNote("n1")] });
      const root = await mount();
      click(root, "payment");
      type(root, "state draft");
      clickEdge(root, "payment-back-shippingAddress");
      expect(section(root)?.querySelector("textarea")?.value).toBe("");
      expect(section(root)?.textContent).not.toContain("note n2");
    });

    test("arrows of one handler share notes and the draft", async () => {
      respond = empty;
      const root = await mountCredit();
      clickEdge(root, "idle-apply-approved");
      expect(section(root)?.querySelector("h3")?.textContent).toBe("Notes on apply from idle");
      expect(section(root)?.querySelector(".hint")?.textContent).toBe(
        "The 3 arrows for apply from idle share these notes.",
      );
      type(root, "half a thought");
      clickEdge(root, "idle-apply-rejected");
      expect(section(root)?.querySelector("textarea")?.value).toBe("half a thought");
    });

    test("a stay arrow can be noted", async () => {
      respond = empty;
      const root = await mountCredit();
      clickEdge(root, "idle-setTier-stay");
      expect(section(root)?.querySelector("h3")?.textContent).toBe("Notes on setTier from idle");
    });
  });
});
