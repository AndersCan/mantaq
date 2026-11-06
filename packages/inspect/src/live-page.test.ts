// @vitest-environment happy-dom
import { RealClock, VirtualClock } from "@mantaq/core";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven, mountLiveDriven } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");

async function documentText(): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createCheckoutActor }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

describe("mountDriven", () => {
  test("mounts the viewer with a live driver for a machine that has a target", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const create = () => {
      const clock = VirtualClock();
      return { actor: createCheckoutActor(clock), clock };
    };
    mountDriven(root, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
    });
    expect(root.querySelector("[data-send]")).not.toBeNull();
  });

  test("without a target the viewer is the static walk", async () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await documentText(), targets: {} });
    expect(root.querySelector("[data-send]")).toBeNull();
  });

  test("an invalid document lists its issues", () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: "{}", targets: {} });
    expect(root.textContent).toContain("Cannot show test");
  });
});

describe("mountDriven targets", () => {
  test("a target on a real clock stays a static walk instead of throwing", async () => {
    const root = document.createElement("div");
    const create = () => ({
      actor: createCheckoutActor(VirtualClock()),
      clock: RealClock() as unknown as ReturnType<typeof VirtualClock>,
    });
    mountDriven(root, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
    });
    expect(root.querySelector("[data-send]")).toBeNull();
  });
});

describe("mountLiveDriven", () => {
  async function failing(fetcher: typeof fetch): Promise<string> {
    const root = document.createElement("div");
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      await mountLiveDriven(root, { source: "/viz.json", targets: {} });
    } finally {
      globalThis.fetch = original;
    }
    return root.textContent ?? "";
  }

  test("a non-OK response lists the issue", async () => {
    expect(
      await failing((async () => new Response("no", { status: 500 })) as typeof fetch),
    ).toContain("HTTP 500");
  });

  test("a network error lists the issue", async () => {
    const down = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await failing(down)).toContain("network error");
  });
});

describe("mountDriven with several machines", () => {
  async function twoText(): Promise<string> {
    const doc = JSON.parse(await documentText());
    doc.machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    return JSON.stringify(doc);
  }

  test("the picker lists every machine and an unknown ?machine= falls back to the first", async () => {
    history.replaceState(null, "", "?machine=nope");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await twoText(), targets: {} });
    const buttons = [...root.querySelectorAll("nav.machines button")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(["checkout", "second"]);
    expect(buttons.map((b) => b.disabled)).toEqual([true, false]);
  });

  test("clicking a machine switches the URL and the shown machine", async () => {
    history.replaceState(null, "", "?machine=checkout&step=1");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await twoText(), targets: {} });
    (root.querySelectorAll("nav.machines button")[1] as HTMLButtonElement).click();
    expect(location.search).toBe("?machine=second");
    const buttons = [...root.querySelectorAll("nav.machines button")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });
});

describe("mountDriven heading and walk ownership", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };
  const current = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".explore")?.dataset["current"];

  test("heading sets the title level; the default is h1", async () => {
    history.replaceState(null, "", "?");
    const text = await documentText();
    const plain = document.createElement("div");
    mountDriven(plain, { source: "test", text, targets: {} });
    const small = document.createElement("div");
    mountDriven(small, { source: "test", text, targets: {}, heading: "h2" });
    expect(plain.querySelector("h1")).not.toBeNull();
    expect(small.querySelector("h1")).toBeNull();
    expect(small.querySelector("h2")).not.toBeNull();
  });

  test("a walk for another machine's id is not replayed here", async () => {
    history.replaceState(null, "", "?");
    const text = await documentText();
    const first = document.createElement("div");
    mountDriven(first, { source: "test", text, targets: { checkout: create } });
    const start = current(first);
    for (const send of first.querySelectorAll<HTMLElement>("[data-send]")) {
      if (current(first) !== start) break;
      send.click();
    }
    expect(current(first)).not.toBe(start);
    const walk = new URLSearchParams(location.search);
    expect(walk.getAll("step").length).toBeGreaterThan(0);

    walk.set("machine", "somewhere-else");
    history.replaceState(null, "", `?${walk.toString()}`);
    const second = document.createElement("div");
    mountDriven(second, { source: "test", text, targets: { checkout: create } });
    expect(current(second)).toBe(start);

    walk.set("machine", "checkout");
    history.replaceState(null, "", `?${walk.toString()}`);
    const third = document.createElement("div");
    mountDriven(third, { source: "test", text, targets: { checkout: create } });
    expect(current(third)).not.toBe(start);
  });
});
