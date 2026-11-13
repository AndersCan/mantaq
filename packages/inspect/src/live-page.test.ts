// @vitest-environment happy-dom
import { RealClock, VirtualClock } from "@mantaq/core";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createAnswerActor } from "./fixtures/answer.ts";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven, mountLiveDriven, readStorage } from "./live-page.ts";
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

  test("effectMode real runs the machine's effects; default holds them", async () => {
    const text = await documentText();
    const create = () => {
      const clock = VirtualClock();
      return { actor: createCheckoutActor(clock), clock };
    };
    const modeOf = (effectMode?: "real") => {
      const root = document.createElement("div");
      document.body.append(root);
      mountDriven(root, {
        source: "test",
        text,
        targets: { checkout: create },
        ...(effectMode === undefined ? {} : { effectMode }),
      });
      return root.querySelector("[data-live-note]")?.getAttribute("data-effect-mode");
    };
    expect(modeOf("real")).toBe("real");
    expect(modeOf()).toBe("held");
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

describe("mountDriven preview", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };
  const frameOf = async (preview?: { path: string; machines: string[] }) => {
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
      ...(preview === undefined ? {} : { preview }),
    });
    return root.querySelector("iframe");
  };

  test("a previewed machine opens on a frame of the preview page with the live state", async () => {
    const frame = await frameOf({ path: "/__mantaq/preview", machines: ["checkout"] });
    const src = new URL(frame?.getAttribute("src") ?? "", "http://x");
    expect(src.pathname).toBe("/__mantaq/preview");
    expect(src.searchParams.get("machine")).toBe("checkout");
    expect(JSON.parse(src.searchParams.get("state") ?? "{}").name).toBe("basicInfo");
  });

  test("no frame without a preview, or for a machine that has none", async () => {
    expect(await frameOf()).toBeNull();
    expect(await frameOf({ path: "/p", machines: ["other"] })).toBeNull();
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

describe("mountDriven filled forms", () => {
  test("the answer form starts with the code the machine is waiting on", async () => {
    const answerFile = join(import.meta.dirname, "fixtures", "answer.ts");
    const inspected = await inspectModule(answerFile, {
      load: async () => ({ createAnswerActor }),
      fuzz: false,
    });
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        answer: () => {
          const clock = VirtualClock();
          return { actor: createAnswerActor(clock), clock };
        },
      },
    });
    const click = (selector: string) => root.querySelector<HTMLButtonElement>(selector)?.click();
    click('[data-send="ask"]');
    const code = root.querySelector<HTMLInputElement>('[data-field="code"]');
    const album = root.querySelector<HTMLInputElement>('[data-field="album"]');
    if (code) code.value = "c1";
    if (album) album.value = "Trip";
    click('[data-payload-send="ask"]');
    click('[data-send="answered"]');
    expect(root.querySelector<HTMLInputElement>('[data-field="code"]')?.value).toBe("c1");
    const declined = [
      ...root.querySelectorAll<HTMLButtonElement>('[data-field="answer"] button'),
    ].find((each) => each.getAttribute("data-choice") === '"declined"');
    declined?.click();
    click('[data-payload-send="answered"]');
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("declined");
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
      first.querySelector<HTMLElement>("[data-payload-send]")?.click();
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

describe("mountDriven runs by name", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };
  const current = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".explore")?.dataset["current"];
  const basic = {
    kind: "event",
    event: "submitBasicInfo",
    payload: { email: "a@b.c", name: "A" },
  };

  async function withRuns(): Promise<string> {
    const doc = JSON.parse(await documentText());
    doc.machines = [
      { ...doc.machines[0], runs: [{ name: "gives basic info", steps: [basic] }] },
      { ...doc.machines[0], id: "second" },
    ];
    return JSON.stringify(doc);
  }

  test("?machine=&run= opens at the run's end and leaves the address bar alone", async () => {
    history.replaceState(null, "", "?machine=checkout&run=gives%20basic%20info");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await withRuns(), targets: { checkout: create } });
    expect(current(root)).toBe("shippingAddress");
    expect(location.search).toBe("?machine=checkout&run=gives%20basic%20info");
  });

  test("clicking a run writes machine and run, no step", async () => {
    history.replaceState(null, "", "?machine=checkout");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await withRuns(), targets: { checkout: create } });
    root.querySelector<HTMLElement>('[data-run="gives basic info"]')?.click();
    expect(new URLSearchParams(location.search).get("run")).toBe("gives basic info");
    expect(new URLSearchParams(location.search).has("step")).toBe(false);
  });

  test("switching machine drops run", async () => {
    history.replaceState(null, "", "?machine=checkout&run=gives%20basic%20info");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await withRuns(), targets: {} });
    (root.querySelectorAll("nav.machines button")[1] as HTMLButtonElement).click();
    expect(location.search).toBe("?machine=second");
  });

  test("run= without machine opens the start with no notice", async () => {
    history.replaceState(null, "", "?run=gives%20basic%20info");
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await withRuns(), targets: { checkout: create } });
    expect(current(root)).toBe("basicInfo");
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });
});

describe("a link naming several machines", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };
  const current = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".explore")?.dataset["current"];
  const basic = {
    kind: "event",
    event: "submitBasicInfo",
    payload: { email: "a@b.c", name: "A" },
  };

  async function twoDocuments(): Promise<[string, string]> {
    const doc = JSON.parse(await documentText());
    const run = { name: "gives basic info", steps: [basic] };
    const first = { ...doc, machines: [{ ...doc.machines[0], runs: [run] }] };
    const second = { ...doc, machines: [{ ...doc.machines[0], id: "second", runs: [run] }] };
    return [JSON.stringify(first), JSON.stringify(second)];
  }

  test("each viewer opens the run on the machine it holds", async () => {
    const search = "?machine=checkout&machine=second&run=gives%20basic%20info";
    history.replaceState(null, "", search);
    const [first, second] = await twoDocuments();
    const targets = { checkout: create, second: create };
    const one = document.createElement("div");
    const two = document.createElement("div");
    mountDriven(one, { source: "test", text: first, targets });
    mountDriven(two, { source: "test", text: second, targets });
    expect(current(one)).toBe("shippingAddress");
    expect(current(two)).toBe("shippingAddress");
    expect(location.search).toBe(search);
  });

  test("a viewer holding none of them opens at its start", async () => {
    history.replaceState(null, "", "?machine=x&machine=y&run=gives%20basic%20info");
    const [first] = await twoDocuments();
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: first, targets: { checkout: create } });
    expect(current(root)).toBe("basicInfo");
  });

  test("a viewer holding only a later name opens that one", async () => {
    history.replaceState(null, "", "?machine=x&machine=second&machine=x&run=gives%20basic%20info");
    const [, second] = await twoDocuments();
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: second, targets: { second: create } });
    expect(current(root)).toBe("shippingAddress");
  });
});

describe("compare", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };
  const targets = { checkout: create, second: create };
  const current = (root: Element) =>
    root.querySelector<HTMLElement>(".explore")?.dataset["current"];

  async function twoText(): Promise<string> {
    const doc = JSON.parse(await documentText());
    doc.machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    return JSON.stringify(doc);
  }

  async function draw(search: string, text?: string): Promise<HTMLElement> {
    history.replaceState(null, "", search);
    const body = text ?? (await twoText());
    const root = document.createElement("div");
    document.body.append(root);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body)) as typeof fetch;
    try {
      await mountLiveDriven(root, { source: "/viz.json", targets });
    } finally {
      globalThis.fetch = original;
    }
    return root;
  }
  const texts = (root: ParentNode, selector: string) =>
    [...root.querySelectorAll(selector)].map((each) => each.textContent);
  const section = (root: ParentNode, design: string) =>
    root.querySelector(`section.compare-design[data-design="${design}"]`) as HTMLElement;

  test("two ids show Design A and Design B side by side", async () => {
    const root = await draw("?machine=checkout&compare=second");
    expect(texts(root, "h1")).toEqual(["Compare designs"]);
    expect(
      [...root.querySelectorAll<HTMLElement>("section.compare-design")].map(
        (each) => each.dataset["design"],
      ),
    ).toEqual(["a", "b"]);
    expect(texts(root, "h2")).toEqual(["Design A", "Design B"]);
    expect(texts(root, "h3").filter((t) => t?.startsWith("Viz: "))).toEqual([
      "Viz: checkout",
      "Viz: second",
    ]);
    expect(root.querySelector("nav.machines")).toBeNull();
    expect(section(root, "a").querySelector("[data-send]")).not.toBeNull();
    expect(section(root, "b").querySelector("[data-send]")).not.toBeNull();
  });

  test("a design not in the document shows a notice in its column and never another machine", async () => {
    const root = await draw("?machine=checkout&compare=nope");
    expect(section(root, "b").querySelector(".compare-missing")?.textContent).toBe(
      "Design B: nope is not on this page. Ask your agent to check the dev server output.",
    );
    expect(section(root, "b").querySelector("h3")).toBeNull();
    expect(section(root, "a").querySelector("h3")?.textContent).toBe("Viz: checkout");
    expect(root.textContent).not.toContain("Viz: second");
  });

  test("neither design in the document shows one notice", async () => {
    const root = await draw("?machine=x&compare=y");
    expect(root.querySelector("section.compare-design")).toBeNull();
    expect(texts(root, ".compare-missing")).toEqual([
      "Neither draft is on this page. Ask your agent to check the dev server output.",
    ]);
  });

  test("compare equal to machine, or without machine, is the single viewer", async () => {
    for (const search of ["?machine=checkout&compare=checkout", "?compare=second"]) {
      const root = await draw(search);
      expect(root.querySelector("nav.machines")).not.toBeNull();
      expect(root.querySelector("section.compare-design")).toBeNull();
    }
  });

  test("each design keeps its own walk in the URL across a redraw", async () => {
    const root = await draw("?machine=checkout&compare=second");
    const walk = (column: HTMLElement) => {
      const start = current(column);
      for (const send of column.querySelectorAll<HTMLElement>("[data-send]")) {
        if (current(column) !== start) break;
        send.click();
        column.querySelector<HTMLElement>("[data-payload-send]")?.click();
      }
    };
    const startA = current(section(root, "a"));
    walk(section(root, "b"));
    const params = () => new URLSearchParams(location.search);
    expect(params().getAll("stepB").length).toBeGreaterThan(0);
    expect(params().getAll("step").length).toBe(0);
    const stepB = params().getAll("stepB");
    walk(section(root, "a"));
    expect(params().getAll("step").length).toBeGreaterThan(0);
    expect(params().getAll("stepB")).toEqual(stepB);
    expect(params().get("compare")).toBe("second");
    const after = [current(section(root, "a")), current(section(root, "b"))];
    expect(after[0]).not.toBe(startA);

    const again = await draw(location.search);
    expect([current(section(again, "a")), current(section(again, "b"))]).toEqual(after);
  });

  test("an invalid document in compare mode lists its issues", async () => {
    const root = await draw("?machine=checkout&compare=second", "{}");
    expect(root.textContent).toContain("Cannot show");
  });
});

describe("mountLiveDriven notes", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: createCheckoutActor(clock), clock };
  };

  async function fetched(search: string, notes: string | undefined): Promise<string[]> {
    history.replaceState(null, "", search);
    const doc = JSON.parse(await documentText());
    doc.machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string) => {
      urls.push(String(input));
      return String(input).includes("notes")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(doc));
    }) as typeof fetch;
    try {
      const root = document.createElement("div");
      await mountLiveDriven(root, {
        source: "/viz.json",
        targets: { checkout: create, second: create },
        ...(notes === undefined ? {} : { notes }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.fetch = original;
    }
    return urls;
  }

  test("without a notes url nothing asks for notes", async () => {
    const urls = await fetched("?machine=checkout", undefined);
    expect(urls.filter((each) => each.includes("notes"))).toEqual([]);
  });

  test("with a notes url a live machine asks for its notes once", async () => {
    const urls = await fetched("?machine=checkout", "/__mantaq/notes");
    expect(urls.filter((each) => each.includes("notes"))).toEqual([
      "/__mantaq/notes?machine=checkout",
    ]);
  });

  test("compare mode never asks for notes", async () => {
    const urls = await fetched("?machine=checkout&compare=second", "/__mantaq/notes");
    expect(urls.filter((each) => each.includes("notes"))).toEqual([]);
  });
});

describe("mountDriven what changed", () => {
  const source = "/viz.json";
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };
  const draw = (text: string, seen?: ReturnType<typeof fakeStorage>) => {
    history.replaceState(null, "", "?machine=checkout");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, { source, text, targets: {}, ...(seen === undefined ? {} : { seen }) });
    return root;
  };
  const withState = async () => {
    const doc = JSON.parse(await documentText());
    doc.machines[0].states.push({ ...doc.machines[0].states[0], id: "brandNew" });
    return JSON.stringify(doc);
  };

  test("the first mount stores one outline per machine and shows no list", async () => {
    const seen = fakeStorage();
    const root = draw(await documentText(), seen);
    expect([...seen.map.keys()]).toEqual([`mantaq:seen:v1:${source}:checkout`]);
    expect(root.querySelector("section.changes")).toBeNull();
  });

  test("a later mount marks the new state and keeps the baseline", async () => {
    const seen = fakeStorage();
    draw(await documentText(), seen);
    const baseline = [...seen.map.values()];
    const root = draw(await withState(), seen);
    expect(
      root.querySelector('g.state[data-node-id="brandNew"]')?.classList.contains("added"),
    ).toBe(true);
    expect(root.querySelector("section.changes")?.textContent).toContain("Added state brandNew");
    expect([...seen.map.values()]).toEqual(baseline);
  });

  test("Mark as seen stores the current outline", async () => {
    const seen = fakeStorage();
    draw(await documentText(), seen);
    const changed = await withState();
    const root = draw(changed, seen);
    root.querySelector<HTMLButtonElement>("section.changes button")?.click();
    expect(draw(changed, seen).querySelector("section.changes")).toBeNull();
  });

  test.each([
    "{",
    '{"states":3}',
    '{"states":[],"arrows":[{"from":"a","event":"e","to":null,"kind":"bad"}]}',
    '{"states":[],"arrows":[{"from":"a","event":"e","to":3,"kind":"stay"}]}',
  ])("a corrupt stored value %s is overwritten", async (bad) => {
    const seen = fakeStorage();
    seen.map.set(`mantaq:seen:v1:${source}:checkout`, bad);
    const root = draw(await documentText(), seen);
    expect(root.querySelector("section.changes")).toBeNull();
    expect(JSON.parse(seen.map.get(`mantaq:seen:v1:${source}:checkout`) ?? "")).toHaveProperty(
      "states",
    );
  });

  test("storage whose read throws gives no storage", () => {
    expect(
      readStorage(() => {
        throw new Error("SecurityError");
      }),
    ).toBeUndefined();
    const storage = fakeStorage();
    expect(readStorage(() => storage)).toBe(storage);
  });

  test("storage that throws leaves the page working without a list", async () => {
    const seen = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const root = document.createElement("div");
    mountDriven(root, { source, text: await documentText(), targets: {}, seen });
    expect(root.querySelector(".explore")).not.toBeNull();
    expect(root.querySelector("section.changes")).toBeNull();
  });

  test("without seen nothing is stored and nothing is listed", async () => {
    const root = draw(await withState());
    expect(root.querySelector("section.changes")).toBeNull();
  });

  test("the compare page shows no list", async () => {
    const seen = fakeStorage();
    draw(await documentText(), seen);
    const doc = JSON.parse(await withState());
    doc.machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    history.replaceState(null, "", "?machine=checkout&compare=second");
    const root = document.createElement("div");
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(doc))) as typeof fetch;
    try {
      await mountLiveDriven(root, { source, targets: {}, seen });
    } finally {
      globalThis.fetch = original;
    }
    expect(root.querySelector("section.changes")).toBeNull();
  });
});
