// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { answer as answerMachine } from "./fixtures/answer.ts";
import { checkout as checkoutMachine } from "./fixtures/checkout.ts";
import { stateRouting } from "./fixtures/state-routing.ts";
import { nestedRegions } from "./fixtures/nested-regions.ts";
import { stubborn } from "./fixtures/machine-values.ts";
import { grouped } from "./fixtures/grouped.ts";
import { timed as timedMachine } from "./fixtures/timed.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven, mountLiveDriven, takeTargets } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";
import { sendVia } from "./send-via.ts";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");

interface SetFieldOptions {
  /** How the arrow's edge id ends, e.g. `-answered-accepted`. */
  arrow: string;
  field: string;
  text: string;
}

/** Opens the arrow's Details with its `?` and types into its send form, as a person does. */
function setField(root: HTMLElement, options: SetFieldOptions): void {
  root
    .querySelector(`.graph [data-details-edge$="${options.arrow}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const box = root.querySelector<HTMLInputElement>(
    `[data-send-form] [data-value="${options.field}"]`,
  );
  if (box === null) throw new Error(`no ${options.field} box`);
  box.value = options.text;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

async function groupedText(): Promise<string> {
  const inspected = await inspectModule(join(import.meta.dirname, "fixtures", "grouped.ts"), {
    load: () => Promise.resolve({ grouped }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

/** Clicks `enter` on the payment group node, as a person does. */
function enterPayment(root: HTMLElement): void {
  const enter = root.querySelector('.machine-enter[data-enter-group="@payment"]');
  enter?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  enter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function documentText(fuzz = false): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ checkout: checkoutMachine }),
    fuzz: fuzz ? {} : false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

describe("mountDriven", () => {
  test("mounts the viewer with a live driver for a machine that has a target", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const create = () => {
      const clock = VirtualClock();
      return { actor: checkoutMachine.create({ clock }), clock };
    };
    mountDriven(root, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
    });
    expect(root.querySelector(".graph g.edge.next")).not.toBeNull();
  });

  test("a right-click on a state keeps the browser's own menu", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, { source: "test", text: await documentText(), targets: {} });
    const state = root.querySelector(".state");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    state?.dispatchEvent(event);
    expect(state).not.toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  test("effectMode real runs the machine's effects; default holds them", async () => {
    const text = await documentText();
    const create = () => {
      const clock = VirtualClock();
      return { actor: checkoutMachine.create({ clock }), clock };
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

  test("without a target the viewer shows the diagram and Details only", async () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await documentText(), targets: {} });
    expect(root.querySelector(".explore")).toBeNull();
    expect(root.querySelector("[data-send], [data-send-edge]")).toBeNull();
    expect(root.querySelector("[data-tab=details]")).not.toBeNull();
  });

  test("an invalid document lists its issues", () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: "{}", targets: {} });
    expect(root.textContent).toContain("Cannot show test");
  });
});

describe("takeTargets", () => {
  test("a hot-updated module brings the new previewed machines with its targets", () => {
    const targets = {};
    expect(takeTargets({ targets, previewed: ["door"] })).toEqual({ targets, previewed: ["door"] });
  });
});

describe("mountDriven preview", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: checkoutMachine.create({ clock }), clock };
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

  test("the frame carries the whole live state, a title, and stays out of the tab order", async () => {
    const frame = await frameOf({ path: "/__mantaq/preview", machines: ["checkout"] });
    const src = new URL(frame?.getAttribute("src") ?? "", "http://x");
    const state = JSON.parse(src.searchParams.get("state") ?? "{}");
    expect(Object.keys(state).sort()).toEqual(["context", "name", "payload"]);
    expect(state.context).toBeDefined();
    expect(frame?.title).toBe("Screen of checkout: basicInfo");
    expect(frame?.tabIndex).toBe(-1);
  });

  test("clicking a state with Screen open previews it on a copy and keeps the live state", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: await documentText(true),
      targets: { checkout: create },
      preview: { path: "/__mantaq/preview", machines: ["checkout"] },
    });
    root
      .querySelector('[data-node-id="payment"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const src = new URL(root.querySelector("iframe")?.getAttribute("src") ?? "", "http://x");
    expect(JSON.parse(src.searchParams.get("state") ?? "{}").name).toBe("payment");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("basicInfo");
    expect(root.querySelector("[data-tab-panel=screen]")?.hasAttribute("hidden")).toBe(false);
  });

  test("no frame without a preview, or for a machine that has none", async () => {
    expect(await frameOf()).toBeNull();
    expect(await frameOf({ path: "/p", machines: ["other"] })).toBeNull();
  });
});

describe("mountDriven machines without timers", () => {
  /** The target the page builds for a machine: the page's clock goes into `create`. */
  function target() {
    return () => {
      const clock = VirtualClock();
      return { actor: answerMachine.create({ clock }), clock };
    };
  }

  async function answerText(): Promise<string> {
    const inspected = await inspectModule(join(import.meta.dirname, "fixtures", "answer.ts"), {
      load: async () => ({ answer: answerMachine }),
      fuzz: false,
    });
    return serializeViz(vizDocument(inspected.machines));
  }

  test("a machine on the clock the page gives it runs live and marks its current state", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: await answerText(),
      targets: { answer: target() },
    });
    expect(root.querySelector("[data-live-note]")).not.toBeNull();
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("noAskYet");
    root.remove();
  });
});

describe("mountDriven timers when effects run", () => {
  async function timedText(): Promise<string> {
    const inspected = await inspectModule(join(import.meta.dirname, "fixtures", "timed.ts"), {
      load: async () => ({ timed: timedMachine }),
      fuzz: false,
    });
    return serializeViz(vizDocument(inspected.machines));
  }

  function mountRoot(): HTMLElement {
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    return root;
  }

  test("a timer machine on a VirtualClock starts its timer and does not throw", async () => {
    const root = mountRoot();
    mountDriven(root, {
      source: "test",
      text: await timedText(),
      effectMode: "real",
      targets: {
        timed: () => {
          const clock = VirtualClock();
          return { actor: timedMachine.create({ clock }), clock };
        },
      },
    });
    root
      .querySelector<SVGElement>("g.edge.next")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.textContent).toContain("start: idle → waiting");
    expect(root.textContent).not.toContain("VirtualClock");
    expect(root.querySelector("[data-advance-timer]")).not.toBeNull();
    root.remove();
  });
});

describe("mountDriven values", () => {
  test("the answer events send the code the machine is waiting on and the value changed in the send form", async () => {
    const answerFile = join(import.meta.dirname, "fixtures", "answer.ts");
    const inspected = await inspectModule(answerFile, {
      load: async () => ({ answer: answerMachine }),
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
          return { actor: answerMachine.create({ clock }), clock };
        },
      },
    });
    sendVia(root, "ask");
    setField(root, { arrow: "-answered-accepted", field: "answer", text: "declined" });
    sendVia(root, "answered");
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("declined");
  });
});

describe("mountDriven arrows that land elsewhere", () => {
  test("the declined arrow fires and sends answer declined", async () => {
    const answerFile = join(import.meta.dirname, "fixtures", "answer.ts");
    const inspected = await inspectModule(answerFile, {
      load: async () => ({ answer: answerMachine }),
      fuzz: false,
    });
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        answer: () => {
          const clock = VirtualClock();
          return { actor: answerMachine.create({ clock }), clock };
        },
      },
    });
    sendVia(root, "ask");
    const arrow = (to: string) =>
      root.querySelector<SVGGElement>(`.graph g[data-edge-id$="-answered-${to}"]`);
    arrow("declined")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("declined");
    expect(root.querySelector("[data-details-sent]")?.textContent).toContain('"answer":"declined"');
    expect(root.querySelector(".blocked-lock")).toBeNull();
  });
});

describe("mountDriven stateRouting", () => {
  test("an arrow that stays in first is locked, says where it stays, and a click sends nothing", async () => {
    const inspected = await inspectModule(
      join(import.meta.dirname, "fixtures", "state-routing.ts"),
      {
        load: async () => ({ stateRouting }),
        fuzz: false,
      },
    );
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        stateRouting: () => {
          const clock = VirtualClock();
          return { actor: stateRouting.create({ clock }), clock };
        },
      },
    });
    const arrow = (to: string) =>
      root.querySelector<SVGGElement>(`.graph g[data-edge-id$="-back-${to}"]`);
    expect(arrow("second")?.querySelector(".blocked-lock")).not.toBeNull();
    arrow("second")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const id = arrow("second")?.getAttribute("data-edge-id") ?? "";
    root
      .querySelector(`[data-details-edge="${id}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect({
      note: root.querySelector("[data-blocked-note]")?.textContent,
      title: arrow("second")?.querySelector(":scope > title")?.textContent,
      current: root.querySelector(".explore")?.getAttribute("data-current"),
      steps: root.querySelectorAll(".explore-run > li").length,
    }).toEqual({
      note: "back stays in first, not second",
      title: "back stays in first, not second",
      current: "first",
      steps: 0,
    });
    expect(arrow("first")?.querySelector(".blocked-lock")).toBeNull();
    arrow("first")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("first");
    expect(root.textContent).toContain("Sent back: stayed in first");
  });

  test("an arrow whose handler throws stays open and a click shows the error", async () => {
    const inspected = await inspectModule(
      join(import.meta.dirname, "fixtures", "nested-regions.ts"),
      {
        load: async () => ({ nestedRegions }),
        fuzz: false,
      },
    );
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        nestedRegions: () => {
          const clock = VirtualClock();
          return { actor: nestedRegions.create({ clock }), clock };
        },
      },
    });
    const boom = root.querySelector<SVGGElement>(
      '.graph g[data-edge-id="worker.ready-boom-worker.running"]',
    );
    expect(boom?.querySelector(".blocked-lock")).toBeNull();
    boom?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.textContent).toContain("worker exploded");
  });
});

describe("mountDriven dry run payload", () => {
  test("the dry run sends the code the walk is waiting on, as Send does", async () => {
    const answerFile = join(import.meta.dirname, "fixtures", "answer.ts");
    const inspected = await inspectModule(answerFile, {
      load: async () => ({ answer: answerMachine }),
      fuzz: false,
    });
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        answer: () => {
          const clock = VirtualClock();
          return { actor: answerMachine.create({ clock }), clock };
        },
      },
    });
    setField(root, { arrow: "-ask-waitingForAnswer", field: "code", text: "zz-not-the-example" });
    sendVia(root, "ask");
    const arrow = (to: string) =>
      root.querySelector<SVGGElement>(`.graph g[data-edge-id$="-answered-${to}"]`);
    arrow("declined")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".explore")?.getAttribute("data-current")).toBe("declined");
    expect(root.querySelector("[data-details-sent]")?.textContent).toContain(
      '"code":"zz-not-the-example"',
    );
  });

  test("a value changed in the send form keeps the other arrow locked", async () => {
    const answerFile = join(import.meta.dirname, "fixtures", "answer.ts");
    const inspected = await inspectModule(answerFile, {
      load: async () => ({ answer: answerMachine }),
      fuzz: false,
    });
    history.replaceState(null, "", "/");
    const root = document.createElement("div");
    document.body.append(root);
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: {
        answer: () => {
          const clock = VirtualClock();
          return { actor: answerMachine.create({ clock }), clock };
        },
      },
    });
    sendVia(root, "ask");
    setField(root, { arrow: "-answered-accepted", field: "answer", text: "declined" });
    const arrow = (to: string) =>
      root.querySelector<SVGGElement>(`.graph g[data-edge-id$="-answered-${to}"]`);
    expect({
      note: root.querySelector("[data-blocked-note]")?.textContent,
      accepted: arrow("accepted")?.querySelector(".blocked-lock") !== null,
      declined: arrow("declined")?.querySelector(".blocked-lock") !== null,
    }).toEqual({
      note: "answered goes to declined, not accepted",
      accepted: true,
      declined: false,
    });
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

  test("clicking a machine shows it and drops the focus path, and the address stays as it was", async () => {
    history.replaceState(undefined, "", "?machine=grouped");
    const doc = JSON.parse(await groupedText());
    const machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: JSON.stringify({ ...doc, machines }), targets: {} });
    enterPayment(root);
    const entered = root.querySelector(".focus-path") !== null;
    root.querySelectorAll<HTMLButtonElement>("nav.machines button")[1]?.click();
    const disabled = [...root.querySelectorAll<HTMLButtonElement>("nav.machines button")].map(
      (button) => button.disabled,
    );
    const path = root.querySelector(".focus-path") !== null;
    expect({ entered, disabled, path, search: location.search }).toEqual({
      entered: true,
      disabled: [false, true],
      path: false,
      search: "?machine=grouped",
    });
  });
});

describe("mountDriven walk ownership", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: checkoutMachine.create({ clock }), clock };
  };
  const current = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".explore")?.dataset["current"];

  test("a redraw on the same root replays the walk taken there, and the address stays as it was", async () => {
    history.replaceState(undefined, "", "?machine=checkout");
    const context = { source: "test", text: await documentText(), targets: { checkout: create } };
    const root = document.createElement("div");
    mountDriven(root, context);
    sendVia(root);
    const walked = current(root);
    mountDriven(root, context);
    const other = document.createElement("div");
    mountDriven(other, context);
    const shown = { walked, redrawn: current(root), other: current(other) };
    expect({ shown, search: location.search }).toEqual({
      shown: { walked: "shippingAddress", redrawn: "shippingAddress", other: "basicInfo" },
      search: "?machine=checkout",
    });
  });

  test("a redraw keeps the group entered and the step taken inside it", async () => {
    history.replaceState(undefined, "", "?machine=grouped");
    function live() {
      const clock = VirtualClock();
      return { actor: grouped.create({ clock }), clock };
    }
    const targets = { grouped: live };
    const context = { source: "test", text: await groupedText(), targets };
    const root = document.createElement("div");
    mountDriven(root, context);
    enterPayment(root);
    sendVia(root);
    const walked = current(root);
    mountDriven(root, context);
    const crumbs = [...root.querySelectorAll(".focus-path li")].map((crumb) => crumb.textContent);
    expect({ walked, redrawn: current(root), crumbs }).toEqual({
      walked: "chargingCard",
      redrawn: "chargingCard",
      crumbs: ["grouped", "payment"],
    });
  });

  test("a walk on a machine the document no longer holds gives way to the link", async () => {
    history.replaceState(undefined, "", "?");
    const doc = JSON.parse(await documentText());
    const root = document.createElement("div");
    const machines = [doc.machines[0], { ...doc.machines[0], id: "second" }];
    const targets = { checkout: create, second: create };
    mountDriven(root, { source: "test", text: JSON.stringify({ ...doc, machines }), targets });
    root.querySelectorAll<HTMLButtonElement>("nav.machines button")[1]?.click();
    sendVia(root);
    mountDriven(root, { source: "test", text: JSON.stringify(doc), targets: { checkout: create } });
    expect(current(root)).toBe("basicInfo");
  });
});

describe("mountDriven runs by name", () => {
  const create = () => {
    const clock = VirtualClock();
    return { actor: checkoutMachine.create({ clock }), clock };
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

  test("switching machine opens the other at its start, not at the link's run", async () => {
    history.replaceState(null, "", "?machine=checkout&run=gives%20basic%20info");
    const root = document.createElement("div");
    const targets = { checkout: create, second: create };
    mountDriven(root, { source: "test", text: await withRuns(), targets });
    root.querySelectorAll<HTMLButtonElement>("nav.machines button")[1]?.click();
    expect(current(root)).toBe("basicInfo");
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });

  test("the run the page names opens at its end", async () => {
    history.replaceState(null, "", "?");
    const root = document.createElement("div");
    mountDriven(root, {
      source: "test",
      text: await withRuns(),
      targets: { checkout: create },
      run: "gives basic info",
    });
    expect(current(root)).toBe("shippingAddress");
  });

  test("a step taken wins over the run the page names on a redraw", async () => {
    history.replaceState(null, "", "?");
    const root = document.createElement("div");
    const context = { source: "test", text: await withRuns(), targets: { checkout: create } };
    mountDriven(root, context);
    sendVia(root);
    const walked = current(root);
    mountDriven(root, { ...context, run: "nope" });
    expect(current(root)).toBe(walked);
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });

  test("a run in the address wins over the run the page names", async () => {
    history.replaceState(null, "", "?machine=checkout&run=other");
    const root = document.createElement("div");
    mountDriven(root, {
      source: "test",
      text: await withRuns(),
      targets: { checkout: create },
      run: "gives basic info",
    });
    expect(current(root)).toBe("basicInfo");
    expect(root.querySelector("[data-run-missing]")).not.toBeNull();
  });

  test("picking another machine opens its start, not the run the page names", async () => {
    history.replaceState(null, "", "?");
    const root = document.createElement("div");
    mountDriven(root, {
      source: "test",
      text: await withRuns(),
      targets: { checkout: create },
      run: "gives basic info",
    });
    (root.querySelectorAll("nav.machines button")[1] as HTMLButtonElement).click();
    expect(root.querySelector("[data-run-missing]")).toBeNull();
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
    return { actor: checkoutMachine.create({ clock }), clock };
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

describe("mountDriven: a machine(...) built on a clock it was not given", () => {
  test("is drawn but not live, so no time control moves the wrong clock", async () => {
    const inspected = await inspectModule(
      join(import.meta.dirname, "fixtures", "machine-values.ts"),
      {
        load: async () => ({ stubborn }),
        fuzz: false,
      },
    );
    // The target exactly as targetsSource emits it for a machine export.
    const target = () => {
      const clock = VirtualClock();
      const made = stubborn.create({ clock });
      return { actor: made, clock, made };
    };
    history.replaceState(null, "", "?machine=stubborn");
    const root = document.createElement("div");
    mountDriven(root, {
      source: "test",
      text: serializeViz(vizDocument(inspected.machines)),
      targets: { stubborn: target },
    });
    history.replaceState(null, "", "?");
    expect(root.querySelector(".explore")).toBeNull();
    expect(root.querySelector("[data-tab=details]")).not.toBeNull();
  });
});
