// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");
const create = () => {
  const clock = VirtualClock();
  return { actor: createCheckoutActor(clock), clock };
};
const original = globalThis.fetch;
afterEach(() => {
  history.replaceState(null, "", "/");
  globalThis.fetch = original;
});

async function documentText(): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createCheckoutActor }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function draw(options: {
  get: Response;
  post?: Response;
  notes?: boolean;
  driver?: boolean;
}) {
  const posts: unknown[] = [];
  globalThis.fetch = (async (_input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return options.post ?? new Response("{}", { status: 500 });
    }
    return options.get.clone();
  }) as typeof fetch;
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: await documentText(),
    targets: options.driver === false ? {} : { checkout: create },
    ...(options.notes === false ? {} : { notes: "/__mantaq/notes" }),
  });
  await tick();
  return { root, posts };
}

const ok = () =>
  new Response(JSON.stringify({ version: 1, file: "x.notes.md", exists: false, notes: [] }));

function type(root: HTMLElement, name: string) {
  const input = root.querySelector<HTMLInputElement>("section.journey input")!;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

describe("journey box", () => {
  test("saves the live steps and end state under the typed name", async () => {
    const saved = {
      version: 1,
      file: "x.notes.md",
      note: { id: "n1", note: "Two sends", target: { kind: "walk" } },
    };
    const { root, posts } = await draw({ get: ok(), post: new Response(JSON.stringify(saved)) });
    const sends = root.querySelectorAll<HTMLElement>("[data-send]");
    sends[0]?.click();
    sends[0]?.click();
    const input = type(root, "Two sends");
    const button = root.querySelector<HTMLButtonElement>("section.journey button")!;
    expect(button.disabled).toBe(false);
    root
      .querySelector("section.journey form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(posts).toHaveLength(1);
    const body = posts[0] as { target: unknown; steps: unknown[]; end: string; note: string };
    expect(body.target).toEqual({ kind: "walk" });
    expect(body.note).toBe("Two sends");
    expect(body.steps.length).toBeGreaterThan(0);
    expect(root.querySelector("section.journey p[role=status]")?.textContent).toBe(
      "Journey saved. Ask your agent to apply the viz notes.",
    );
    expect(input.value).toBe("");
  });

  test("no steps: a hint and a disabled button", async () => {
    const { root } = await draw({ get: ok() });
    type(root, "Anything");
    expect(root.querySelector("section.journey [data-walk]")?.textContent).toBe(
      "Walk the machine first: send an event or advance the clock.",
    );
    expect(root.querySelector<HTMLButtonElement>("section.journey button")!.disabled).toBe(true);
  });

  test("a failed save shows the error and keeps the name", async () => {
    const failure = new Response(JSON.stringify({ error: "the journey needs a name" }), {
      status: 400,
    });
    const { root } = await draw({ get: ok(), post: failure });
    root.querySelector<HTMLElement>("[data-send]")?.click();
    const input = type(root, "Keep me");
    root
      .querySelector("section.journey form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(root.querySelector("section.journey p[role=status]")?.textContent).toBe(
      "Could not save this journey: the journey needs a name. Your name is still here.",
    );
    expect(input.value).toBe("Keep me");
  });

  test("hidden when the notes endpoint does not answer", async () => {
    const { root } = await draw({ get: new Response("no", { status: 404 }) });
    expect(root.querySelector<HTMLElement>("section.journey")?.hidden).toBe(true);
  });

  test("absent without a notes url or without a driver", async () => {
    expect(
      (await draw({ get: ok(), notes: false })).root.querySelector("section.journey"),
    ).toBeNull();
    expect(
      (await draw({ get: ok(), driver: false })).root.querySelector("section.journey"),
    ).toBeNull();
  });
});
